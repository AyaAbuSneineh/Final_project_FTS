import { db } from "../db/client.js";
import { logs } from "../db/schema.js";

import type { ValidLogInput } from "../types.js";

export async function insertLogs(entries: ValidLogInput[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  await db.insert(logs).values(entries);
}