/*  This file is responsible for setting up 
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
  // Must comfortably cover concurrent ingestion flush workers (INGEST_FLUSH_CONCURRENCY,
  // default 4) plus headroom for GET /logs, /logs/aggregate, health checks, and the
  // retention worker, which all share this same pool. Postgres here is capped at 1 CPU,
  // so this is intentionally modest: more connections don't add real parallelism for
  // CPU-bound work, they just add lock/context-switch contention past a point.
  const DEFAULT_POOL_MAX = 10;
  const value = process.env.DB_POOL_MAX;

  if (value === undefined) {
    return DEFAULT_POOL_MAX;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("DB_POOL_MAX must be a positive integer");
  }

  return parsed;
}

// Create a connection pool to the PostgreSQL database
export const pool = new Pool({
  connectionString: databaseUrl, // Use this link to find out where PostgreSQL is located and how it is recognized

  max: parsePoolMax(), // Maximum allowed connections

  idleTimeoutMillis: 30_000,

  connectionTimeoutMillis: 5_000,
});
pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error);
});
// Create a Drizzle ORM instance using the connection pool and schema
export const db = drizzle({
  client: pool,
  schema,
});