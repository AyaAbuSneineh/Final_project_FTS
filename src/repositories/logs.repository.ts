import { db } from "../db/client.js";
import { logs } from "../db/schema.js";
import { ingestionConfig } from "../config/ingestion.config.js";

import type { AggregateBucket, ValidLogInput ,LogQueryFilters,AggregateQueryFilters} from "../types.js";
import type { PoolClient } from "pg";
import { buildLogConditions } from "../query-builders/logs.query-builder.js";
import {desc,asc,count,sql} from "drizzle-orm";

import {buildAggregateConditions,buildBucketExpression} from "../query-builders/aggregation.query-builder.js";
import { pool } from "../db/client.js";

async function insertLogChunk(
  client: PoolClient,
  entries: ValidLogInput[],
  start: number,
  end: number,
): Promise<void> {
  const rowCount = end - start;
  const timestamps = new Array<string>(rowCount);
  const levels = new Array<string>(rowCount);
  const services = new Array<string>(rowCount);
  const messages = new Array<string>(rowCount);
  const attributes = new Array<string>(rowCount);

  for (let index = start; index < end; index++) {
    const entry = entries[index]!; // ! non-null assertion because we know the index is within bounds
    const targetIndex = index - start;

    timestamps[targetIndex] = entry.timestamp.toISOString();
    levels[targetIndex] = entry.level;
    services[targetIndex] = entry.service;
    messages[targetIndex] = entry.message;
    attributes[targetIndex] = JSON.stringify(entry.attributes);
  }
  //Batch insert logs and update rollups in a single query to avoid race conditions between 
  // the two operations. This ensures that the rollup counts are always consistent with the inserted logs.
  await client.query(
    `
      WITH input_rows AS (
        SELECT *
        FROM unnest(
          $1::timestamptz[],
          $2::text[],
          $3::text[],
          $4::text[],
          $5::jsonb[]
        ) AS row_data(
          "timestamp",
          level,
          service,
          message,
          attributes
        )
      ),
      inserted_logs AS (
        INSERT INTO logs (
          "timestamp",
          level,
          service,
          message,
          attributes
        )
        SELECT
          "timestamp",
          level,
          service,
          message,
          attributes
        FROM input_rows
      )
      INSERT INTO log_count_rollups_1m (
        bucket_start,
        service,
        level,
        log_count
      )
      SELECT
        date_bin(
          interval '1 minute',
          "timestamp",
          timestamptz '1970-01-01 00:00:00+00'
        ),
        service,
        level,
        count(*)::bigint
      FROM input_rows
      GROUP BY
        1,
        service,
        level
      -- Deterministic order so every concurrent flush worker locks rollup rows in
      -- the same sequence. Without this, two workers whose chunks both touch the
      -- same two-or-more (bucket, service, level) rows in different orders could
      -- deadlock (Postgres aborts one transaction, its whole chunk would be
      -- rejected and need a client retry even though no data was actually lost).
      ORDER BY
        1,
        service,
        level
      ON CONFLICT (
        bucket_start,
        service,
        level
      )
      DO UPDATE SET
        log_count = log_count_rollups_1m.log_count + EXCLUDED.log_count
    `,
    [
      timestamps,
      levels,
      services,
      messages,
      attributes,
    ],
  );
}

export async function insertLogs(entries: ValidLogInput[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  const client = await pool.connect();
  const chunkSize = ingestionConfig.insertChunkSize;
  let transactionStarted = false;

  try {
    if (entries.length <= chunkSize) {
      await insertLogChunk(client, entries, 0, entries.length);
      return;
    }

    await client.query("BEGIN"); // means start a transaction
    transactionStarted = true;

    for (let start = 0; start < entries.length; start += chunkSize) {
      await insertLogChunk(
        client,
        entries,
        start,
        Math.min(start + chunkSize, entries.length),
      );
    }

    await client.query("COMMIT"); // means save the changes made during the transaction to the database
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK"); // means restore the database to its previous state before the transaction began
      } catch (rollbackError) {
        console.error("Failed to rollback log insert transaction:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredLogsBatch(cutoff: Date, batchSize: number): Promise<number> {
  // Deleting from `logs` alone leaves log_count_rollups_1m holding counts for rows
  // that no longer exist, so an eligible aggregate query would report phantom data
  // for time ranges retention already removed. This adjusts rollups in the same
  // statement as the delete, decrementing each affected bucket by exactly the rows
  // that batch actually removed (never a blind "delete the whole bucket", since the
  // retention cutoff can fall in the middle of a still-partially-live minute
  // bucket), and drops any rollup row that reaches zero so the rollup table doesn't
  // outlive the raw data it summarizes.
  const result = await pool.query<{
    deleted_count: string;
    rollup_rows_removed: string;
  }>(
    `
      WITH expired AS (
        SELECT ctid
        FROM logs
        WHERE "timestamp" < $1::timestamptz
        ORDER BY "timestamp" ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      ),
      deleted AS (
        DELETE FROM logs
        WHERE ctid IN (
          SELECT ctid
          FROM expired
        )
        RETURNING "timestamp", service, level
      ),
      bucket_counts AS (
        SELECT
          date_bin(
            interval '1 minute',
            "timestamp",
            timestamptz '1970-01-01 00:00:00+00'
          ) AS bucket_start,
          service,
          level,
          count(*)::bigint AS removed_count
        FROM deleted
        GROUP BY 1, service, level
        -- Same deterministic-lock-order reasoning as the insert path: this is the
        -- only place besides ingestion that writes to log_count_rollups_1m, so it
        -- follows the same (bucket_start, service, level) lock order to rule out a
        -- deadlock against a concurrent insert upsert touching an overlapping row.
        ORDER BY 1, service, level
      ),
      rollup_update AS (
        UPDATE log_count_rollups_1m AS r
        SET log_count = r.log_count - bc.removed_count
        FROM bucket_counts bc
        WHERE r.bucket_start = bc.bucket_start
          AND r.service = bc.service
          AND r.level = bc.level
        RETURNING r.bucket_start, r.service, r.level, r.log_count
      ),
      rollup_cleanup AS (
        DELETE FROM log_count_rollups_1m
        WHERE (bucket_start, service, level) IN (
          SELECT bucket_start, service, level
          FROM rollup_update
          WHERE log_count <= 0
        )
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM deleted)::bigint AS deleted_count,
        (SELECT count(*) FROM rollup_cleanup)::bigint AS rollup_rows_removed
    `,
    [
      cutoff.toISOString(),
      batchSize,
    ],
  );

  return Number(result.rows[0]?.deleted_count ?? 0);
}

export async function findLogs(filters: LogQueryFilters){
  const conditions = buildLogConditions(filters);

  return db
    .select()
    .from(logs)
    .where(conditions)
    .orderBy(
      desc(logs.timestamp),
      desc(logs.id),
    )
    .limit(filters.limit + 1);
}

type AggregateLogRow = {
  bucket_start: Date;
  group: string | null;
  count: number;
};

function isMinuteAligned(date: Date): boolean {
  return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
}

function getRollupBucketInterval(bucket: AggregateBucket): string {
  switch (bucket) {
    case "1m":
      return "1 minute";

    case "5m":
      return "5 minutes";

    case "1h":
      return "1 hour";

    case "1d":
      return "1 day";
  }
}

function canUseRollups(filters: AggregateQueryFilters): boolean {
  return (
    filters.q === undefined &&
    filters.attributes.length === 0 &&
    isMinuteAligned(filters.since) &&
    isMinuteAligned(filters.until)
  );
}

async function aggregateLogsFromRollups(filters: AggregateQueryFilters): Promise<AggregateLogRow[] | null> {
  if (!canUseRollups(filters)) {
    return null;
  }

  const params: unknown[] = [
    filters.since.toISOString(),
    filters.until.toISOString(),
  ];
  const conditions = [
    "bucket_start >= $1::timestamptz",
    "bucket_start < $2::timestamptz",
  ];

  if (filters.service !== undefined) {
    params.push(filters.service);
    conditions.push(`service = $${params.length}`);
  }

  if (filters.level !== undefined) {
    params.push(filters.level);
    conditions.push(`level = $${params.length}`);
  }

  const interval = getRollupBucketInterval(filters.bucket);
  const bucketExpression = `
    date_bin(
      interval '${interval}',
      bucket_start,
      timestamptz '1970-01-01 00:00:00+00'
    )
  `;

  let groupExpression = "null::text";
  let groupByExpression = bucketExpression;

  if (filters.groupBy === "service") {
    groupExpression = "service";
    groupByExpression = `${bucketExpression}, service`;
  } else if (filters.groupBy === "level") {
    groupExpression = "level";
    groupByExpression = `${bucketExpression}, level`;
  }

  const result = await pool.query<{
    bucket_start: Date;
    group: string | null;
    count: string;
  }>(
    `
      SELECT
        ${bucketExpression} AS bucket_start,
        ${groupExpression} AS "group",
        sum(log_count)::bigint AS count
      FROM log_count_rollups_1m
      WHERE ${conditions.join(" AND ")}
      GROUP BY ${groupByExpression}
      ORDER BY ${bucketExpression} ASC
    `,
    params,
  );

  return result.rows.map((row) => ({
    bucket_start: row.bucket_start,
    group: row.group,
    count: Number(row.count),
  }));
}

export async function aggregateLogs(filters: AggregateQueryFilters): Promise<AggregateLogRow[]>{
  const rollupRows = await aggregateLogsFromRollups(filters);

  if (rollupRows !== null) {
    return rollupRows;
  }

  const conditions = buildAggregateConditions(filters);

  const bucketExpression = buildBucketExpression(filters.bucket);

  

  if (filters.groupBy === "service") {
    return db
      .select({
        bucket_start:
          bucketExpression.as("bucket_start"),

        group: logs.service,

        count: count(),
      })
      .from(logs)
      .where(conditions)
      .groupBy(
        bucketExpression,
        logs.service,
      )
      .orderBy(
        asc(bucketExpression),
      );
  }

  if (filters.groupBy === "level") {
    return db
      .select({
        bucket_start:
          bucketExpression.as("bucket_start"),

        group: logs.level,

        count: count(),
      })
      .from(logs)
      .where(conditions)
      .groupBy(
        bucketExpression,
        logs.level,
      )
      .orderBy(
        asc(bucketExpression),
      );
  }

  return db
    .select({
      bucket_start:
        bucketExpression.as("bucket_start"),

      group: sql<null>`null`,

      count: count(),
    })
    .from(logs)
    .where(conditions)
    .groupBy(bucketExpression)
    .orderBy(
      asc(bucketExpression),
    );
}
