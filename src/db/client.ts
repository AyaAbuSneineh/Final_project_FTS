/* This file is responsible for setting up
   the database connection and exporting the
   Drizzle ORM instance for use in other parts of the application */

import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not defined");
}

function parsePoolMax(): number {
  const DEFAULT_POOL_MAX = 10;
  const value = process.env.DB_POOL_MAX;

  if (value === undefined) {
    return DEFAULT_POOL_MAX;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 3) {
    throw new Error("DB_POOL_MAX must be an integer greater than or equal to 3");
  }

  return parsed;
}

const totalPoolMax = parsePoolMax();

const INGESTION_POOL_MAX = 2;
const GENERAL_POOL_MAX = totalPoolMax - INGESTION_POOL_MAX;

// Used by GET /logs, aggregation, retention, migrations, etc.
export const pool = new Pool({
  connectionString: databaseUrl,
  max: GENERAL_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});

// Dedicated connections for ingestion flush workers.
export const ingestionPool = new Pool({
  connectionString: databaseUrl,
  max: INGESTION_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

ingestionPool.on("error", (error) => {
  console.error("Unexpected PostgreSQL ingestion pool error:", error);
});

// Drizzle uses the general-purpose pool.
export const db = drizzle({
  client: pool,
  schema,
});