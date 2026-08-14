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
