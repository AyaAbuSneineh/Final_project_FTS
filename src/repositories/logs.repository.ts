import { db } from "../db/client.js";
import { logs } from "../db/schema.js";

import type { ValidLogInput ,LogQueryFilters } from "../types.js";
import { buildLogConditions } from "../query-builders/logs.query-builder.js";
import {desc} from "drizzle-orm";

export async function insertLogs(entries: ValidLogInput[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await db.insert(logs).values(entries);
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