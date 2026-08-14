import "dotenv/config";

import { app } from "./app.js";
import { pool } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { checkDatabaseConnection } from "./services/health_service.js";
import { drainPendingInserts } from "./services/ingestion_batcher.service.js";
import { startRetentionWorker } from "./services/retention.service.js";

const PORT = Number(process.env.PORT ?? 8080);
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function startServer(): Promise<void> {
  try {
    await checkDatabaseConnection();

    console.log("Database connection established");

    await runMigrations();

    console.log("Database migrations applied");

    const retentionTimer = startRetentionWorker();

    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });

    let shuttingDown = false;

    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) {
        return;
      }

      shuttingDown = true;

      console.log(`Received ${signal}, shutting down gracefully`);

      if (retentionTimer !== null) {
        clearInterval(retentionTimer);
      }

      // Stop accepting new connections, then let already-accepted requests finish
      // and give buffered-but-not-yet-flushed logs a chance to reach Postgres
      // before the process exits, so an in-flight batch isn't silently dropped.
      server.close();

      try {
        await Promise.race([
          drainPendingInserts(),
          sleep(SHUTDOWN_DRAIN_TIMEOUT_MS),
        ]);
      } catch (error) {
        console.error("Error while draining pending inserts on shutdown:", error);
      }

      await pool.end();

      process.exit(0);
    };

    process.on("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      void shutdown("SIGINT");
    });
  } catch (error) {
    console.error("Failed to start application:", error);

    await pool.end();

    process.exit(1);
  }
}

void startServer();
