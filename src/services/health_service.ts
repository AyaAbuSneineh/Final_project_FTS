import { pool } from "../db/client.js";

// Function to check the database connection by executing a simple query
export async function checkDatabaseConnection(): Promise<void> {
  await pool.query("SELECT 1"); 
}