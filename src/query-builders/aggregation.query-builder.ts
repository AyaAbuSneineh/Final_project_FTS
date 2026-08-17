import {and,eq,gte,lt,sql,type SQL} from "drizzle-orm";

import { logs } from "../db/schema.js";

import type {AggregateBucket,AggregateQueryFilters} from "../types.js";
import { escapeLikePattern } from "../utils/sql.js";
import {buildAttributeCondition} from "./logs.query-builder.js"

export function buildBucketExpression(bucket: AggregateBucket): SQL<Date> {
  switch (bucket) {
    case "1m":
      return sql<Date>`
        date_bin(
          interval '1 minute',
          ${logs.timestamp},
          timestamptz '1970-01-01 00:00:00+00'
        )
      `.mapWith(logs.timestamp);

    case "5m":
      return sql<Date>`
        date_bin(
          interval '5 minutes',
          ${logs.timestamp},
          timestamptz '1970-01-01 00:00:00+00'
        )
      `.mapWith(logs.timestamp);

    case "1h":
      return sql<Date>`
        date_bin(
          interval '1 hour',
          ${logs.timestamp},
          timestamptz '1970-01-01 00:00:00+00'
        )
      `.mapWith(logs.timestamp);

    case "1d":
      return sql<Date>`
        date_bin(
          interval '1 day',
          ${logs.timestamp},
          timestamptz '1970-01-01 00:00:00+00'
        )
      `.mapWith(logs.timestamp);
  }
}

export function buildAggregateConditions(filters: AggregateQueryFilters): SQL | undefined {
  const conditions: SQL[] = [];

  conditions.push(
    gte(logs.timestamp, filters.since),
  );

  conditions.push(
    lt(logs.timestamp, filters.until),
  );

  if (filters.service !== undefined) {
    conditions.push(
      eq(logs.service, filters.service),
    );
  }

  if (filters.level !== undefined) {
    conditions.push(
      eq(logs.level, filters.level),
    );
  }

  for (const attribute of filters.attributes) {
    conditions.push(
    buildAttributeCondition(attribute.key, attribute.value),
  );
  }

  if (filters.q !== undefined) {
    const escapedQuery = escapeLikePattern(filters.q);

    conditions.push(
        sql`${logs.message} ILIKE ${`%${escapedQuery}%`} ESCAPE '\\'`,
    );
    }

  return and(...conditions);
}