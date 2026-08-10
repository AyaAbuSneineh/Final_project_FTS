import "dotenv/config";

import { app } from "./app.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { checkDatabaseConnection } from "./services/health_service.js";

const PORT = Number(process.env.PORT ?? 8080);

async function startServer(): Promise<void> {
  try {
    await checkDatabaseConnection();

    console.log("Database connection established");

    await runMigrations();

    console.log("Database migrations applied");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start application:", error);

    await pool.end();

    process.exit(1);
  }
}

void startServer();