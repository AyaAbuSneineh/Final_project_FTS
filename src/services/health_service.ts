import { pool } from "../db/client.js";
import { ServiceUnavailableError } from "../errors.js";

export async function checkDatabaseConnection(): Promise<void> {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    console.error("Real database error:", error);

    throw new ServiceUnavailableError(
      "database unavailable",
    );
  }
}