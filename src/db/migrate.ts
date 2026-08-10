import { migrate } from "drizzle-orm/node-postgres/migrator";

import { db } from "./client.js";

// Function to run database migrations using Drizzle ORM
export async function runMigrations(): Promise<void> {
  await migrate(db, {
    migrationsFolder: "./drizzle",
  });
}