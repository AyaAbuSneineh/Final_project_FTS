import { db } from "../db/client.js";
import { logs } from "../db/schema.js";

import type { ValidLogInput ,LogQueryFilters,AggregateQueryFilters} from "../types.js";
import { buildLogConditions } from "../query-builders/logs.query-builder.js";
import {desc,asc,count,sql} from "drizzle-orm";

import {buildAggregateConditions,buildBucketExpression} from "../query-builders/aggregation.query-builder.js";
import { pool } from "../db/client.js";

export async function insertLogs(entries: ValidLogInput[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  //simple query await db.insert(logs).values(entries);

  const timestamps = entries.map((entry) =>
    entry.timestamp.toISOString()
  );

  const levels = entries.map((entry) => entry.level);
  const services = entries.map((entry) => entry.service);
  const messages = entries.map((entry) => entry.message);
  const attributes = entries.map((entry) =>
    JSON.stringify(entry.attributes)
  );

  await pool.query(
    `
      INSERT INTO logs (
        timestamp,
        level,
        service,
        message,
        attributes
      )
      SELECT *
      FROM unnest(
        $1::timestamptz[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::jsonb[]
      )
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


export async function aggregateLogs(filters: AggregateQueryFilters){
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