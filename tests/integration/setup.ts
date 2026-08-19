import { pool } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";

let migrated = false;

export async function ensureMigrated(): Promise<void> {
  if (migrated) {
    return;
  }

  await runMigrations();
  migrated = true;
}

export async function resetDb(): Promise<void> {
  await ensureMigrated();
  await pool.query("TRUNCATE TABLE logs, log_count_rollups_1m RESTART IDENTITY");
}
