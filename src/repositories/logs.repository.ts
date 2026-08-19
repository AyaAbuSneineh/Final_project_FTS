import { db } from "../db/client.js";
import { logs } from "../db/schema.js";
import { ingestionConfig } from "../config/ingestion.config.js";

import type { AggregateBucket, ValidLogInput ,LogQueryFilters,AggregateQueryFilters} from "../types.js";
import type { PoolClient } from "pg";
import { buildLogConditions } from "../query-builders/logs.query-builder.js";
import {desc,asc,count,sql} from "drizzle-orm";

import {buildAggregateConditions,buildBucketExpression} from "../query-builders/aggregation.query-builder.js";
import { ingestionPool, pool } from "../db/client.js";

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
          attributes,
          attributes_text
        )
        SELECT
          "timestamp",
          level,
          service,
          message,
          attributes,
          -- Computed here (Postgres has CPU headroom under the resource limits;
          -- the app container is the tighter budget) rather than in the app:
          -- every value in attributes re-expressed as text, so attr.<key>
          -- equality can be answered by logs_attributes_text_gin_idx. COALESCE
          -- covers the empty-attributes case, where jsonb_each has no rows to
          -- aggregate.
          COALESCE(
            (
              SELECT jsonb_object_agg(entry.key, entry.value #>> '{}')
              FROM jsonb_each(attributes) AS entry
            ),
            '{}'::jsonb
          )
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

  const client = await ingestionPool.connect();
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

const MINUTE_MS = 60 * 1000;

type TimeRange = {
  start: Date;
  end: Date;
};

function floorToMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

function ceilToMinute(date: Date): Date {
  const floored = floorToMinute(date);

  if (floored.getTime() === date.getTime()) {
    return floored;
  }

  return new Date(floored.getTime() + MINUTE_MS);
}

function getAggregationRanges(since: Date, until: Date): {
  rawRanges: TimeRange[];
  rollupStart: Date;
  rollupEnd: Date;
} {
  if (since.getTime() >= until.getTime()) {
    return {
      rawRanges: [],
      rollupStart: since,
      rollupEnd: since,
    };
  }

  const rollupStart = ceilToMinute(since);
  const rollupEnd = floorToMinute(until);

  if (rollupStart.getTime() >= rollupEnd.getTime()) {
    return {
      rawRanges: [
        {
          start: since,
          end: until,
        },
      ],
      rollupStart: since,
      rollupEnd: since,
    };
  }

  const rawRanges: TimeRange[] = [];

  if (since.getTime() < rollupStart.getTime()) {
    rawRanges.push({
      start: since,
      end: rollupStart,
    });
  }

  if (rollupEnd.getTime() < until.getTime()) {
    rawRanges.push({
      start: rollupEnd,
      end: until,
    });
  }

  return {
    rawRanges,
    rollupStart,
    rollupEnd,
  };
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

function buildSqlBucketExpression(bucket: AggregateBucket, sourceExpression: string): string {
  const interval = getRollupBucketInterval(bucket);

  return `
    date_bin(
      interval '${interval}',
      ${sourceExpression},
      timestamptz '1970-01-01 00:00:00+00'
    )
  `;
}

function canUseRollups(filters: AggregateQueryFilters): boolean {
  return (
    filters.q === undefined &&
    filters.attributes.length === 0
  );
}

async function aggregateLogsFromRollups(filters: AggregateQueryFilters): Promise<AggregateLogRow[] | null> {
  if (!canUseRollups(filters)) {
    return null;
  }

  const {
    rawRanges,
    rollupStart,
    rollupEnd,
  } = getAggregationRanges(filters.since, filters.until);

  if (
    rawRanges.length === 0 &&
    rollupStart.getTime() >= rollupEnd.getTime()
  ) {
    return [];
  }

  const params: unknown[] = [];
  const pushParam = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const rawRangeConditions = rawRanges.map((range) => {
    const startParam = pushParam(range.start.toISOString());
    const endParam = pushParam(range.end.toISOString());

    return `(l."timestamp" >= ${startParam}::timestamptz AND l."timestamp" < ${endParam}::timestamptz)`;
  });

  const rawConditions = [
    rawRangeConditions.length > 0
      ? `(${rawRangeConditions.join(" OR ")})`
      : "false",
  ];

  let rollupConditions: string[];

  if (rollupStart.getTime() < rollupEnd.getTime()) {
    const rollupStartParam = pushParam(rollupStart.toISOString());
    const rollupEndParam = pushParam(rollupEnd.toISOString());

    rollupConditions = [
      `r.bucket_start >= ${rollupStartParam}::timestamptz`,
      `r.bucket_start < ${rollupEndParam}::timestamptz`,
    ];
  } else {
    rollupConditions = [
      "false",
    ];
  }

  if (filters.service !== undefined) {
    const serviceParam = pushParam(filters.service);

    rawConditions.push(`l.service = ${serviceParam}`);
    rollupConditions.push(`r.service = ${serviceParam}`);
  }

  if (filters.level !== undefined) {
    const levelParam = pushParam(filters.level);

    rawConditions.push(`l.level = ${levelParam}`);
    rollupConditions.push(`r.level = ${levelParam}`);
  }

  const rawBucketExpression = buildSqlBucketExpression(
    filters.bucket,
    'l."timestamp"',
  );
  const rollupBucketExpression = buildSqlBucketExpression(
    filters.bucket,
    "r.bucket_start",
  );

  let rawGroupExpression = "null::text";
  let rollupGroupExpression = "null::text";

  if (filters.groupBy === "service") {
    rawGroupExpression = "l.service";
    rollupGroupExpression = "r.service";
  } else if (filters.groupBy === "level") {
    rawGroupExpression = "l.level";
    rollupGroupExpression = "r.level";
  }

  const result = await pool.query<{
    bucket_start: Date;
    group: string | null;
    count: string;
  }>(
    `
      WITH raw_edges AS (
        SELECT
          ${rawBucketExpression} AS bucket_start,
          ${rawGroupExpression} AS "group",
          count(*)::bigint AS log_count
        FROM logs l
        WHERE ${rawConditions.join(" AND ")}
        GROUP BY 1, 2
      ),
      rollup_middle AS (
        SELECT
          ${rollupBucketExpression} AS bucket_start,
          ${rollupGroupExpression} AS "group",
          sum(r.log_count)::bigint AS log_count
        FROM log_count_rollups_1m r
        WHERE ${rollupConditions.join(" AND ")}
        GROUP BY 1, 2
      ),
      combined AS (
        SELECT bucket_start, "group", log_count
        FROM raw_edges
        UNION ALL
        SELECT bucket_start, "group", log_count
        FROM rollup_middle
      )
      SELECT
        bucket_start,
        "group",
        sum(log_count)::bigint AS count
      FROM combined
      GROUP BY bucket_start, "group"
      ORDER BY bucket_start ASC
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
