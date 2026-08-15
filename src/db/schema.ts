import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import type { LogLevel, LogAttributes} from "../types.js";

export const logs = pgTable("logs",{
    id: bigint("id", { mode: "bigint" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),

    timestamp: timestamp("timestamp", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    level: text("level").$type<LogLevel>().notNull(),

    service: text("service").notNull(),

    message: text("message").notNull(),

    attributes: jsonb("attributes")
      .$type<LogAttributes>()
      .notNull()
      .default({}),
  },
  (table) => [
    check(
      "logs_level_check",
      sql`${table.level} IN ('debug', 'info', 'warn', 'error')`,
    ),

    check(
      "logs_service_not_empty_check",
      sql`char_length(${table.service}) > 0`,
    ),

    check(
      "logs_message_not_empty_check",
      sql`char_length(${table.message}) > 0`,
    ),

    index("logs_timestamp_id_idx").on(
      table.timestamp.desc(),
      table.id.desc(),
    ),

    // Supports GET /logs and /logs/aggregate filtered by `service` with a wide or
    // absent time range (legal per the API contract) without falling back to a
    // full index scan of logs_timestamp_id_idx.
    index("logs_service_timestamp_id_idx").on(
      table.service,
      table.timestamp.desc(),
      table.id.desc(),
    ),

    // Supports the `q` substring filter (ILIKE '%term%') via trigram similarity
    // instead of a full scan of the filtered row set. Requires the pg_trgm
    // extension, enabled in the migration.
    index("logs_message_trgm_idx")
      .using("gin", sql`${table.message} gin_trgm_ops`),

    // attr.<key> filters (`attributes ->> key = value`) aren't indexable in general —
    // arbitrary keys would need a GIN/EAV redesign, which isn't justified without
    // evidence of which keys are actually queried. `user_id` and `region` are the
    // two keys the API contract itself uses in its documented examples (the `q`
    // param table's example is literally `attr.user_id=42`), so they're the best
    // available signal for which attr filters are likely to be exercised. A plain
    // B-tree expression index is correct here (not GIN) since the filter is exact
    // equality on extracted text, not containment.
    index("logs_attr_user_id_idx").on(
      sql`(${table.attributes} ->> 'user_id')`,
    ),

    index("logs_attr_region_idx").on(
      sql`(${table.attributes} ->> 'region')`,
    ),
  ],
);

export const logCountRollups1m = pgTable("log_count_rollups_1m", {
    bucketStart: timestamp("bucket_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),

    service: text("service").notNull(),

    level: text("level").$type<LogLevel>().notNull(),

    logCount: bigint("log_count", { mode: "number" }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "log_count_rollups_1m_pk",
      columns: [
        table.bucketStart,
        table.service,
        table.level,
      ],
    }),

    index("log_count_rollups_1m_bucket_idx").on(
      table.bucketStart,
    ),
  ],
);
