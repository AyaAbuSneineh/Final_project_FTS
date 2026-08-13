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
// Create a connection pool to the PostgreSQL database
export const pool = new Pool({
  connectionString: databaseUrl, // Use this link to find out where PostgreSQL is located and how it is recognized

  max: 5, // Maximum allowed connections

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