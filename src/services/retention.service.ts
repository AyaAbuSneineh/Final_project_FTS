import { deleteExpiredLogsBatch } from "../repositories/logs.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_DELETE_BATCH_SIZE = 5_000;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;
const BATCH_PAUSE_MS = 25;

export interface RetentionConfig {
  enabled: boolean;
  retentionDays: number;
  cleanupIntervalMs: number;
  deleteBatchSize: number;
  maxBatchesPerRun: number;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const value = process.env[name];

  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function getRetentionConfig(): RetentionConfig {
  return {
    enabled: parseBooleanEnv("LOG_RETENTION_ENABLED", true),
    retentionDays: parsePositiveIntegerEnv(
      "LOG_RETENTION_DAYS",
      DEFAULT_RETENTION_DAYS,
    ),
    cleanupIntervalMs: parsePositiveIntegerEnv(
      "RETENTION_CLEANUP_INTERVAL_MS",
      DEFAULT_CLEANUP_INTERVAL_MS,
    ),
    deleteBatchSize: parsePositiveIntegerEnv(
      "RETENTION_DELETE_BATCH_SIZE",
      DEFAULT_DELETE_BATCH_SIZE,
    ),
    maxBatchesPerRun: parsePositiveIntegerEnv(
      "RETENTION_MAX_BATCHES_PER_RUN",
      DEFAULT_MAX_BATCHES_PER_RUN,
    ),
  };
}

export async function runRetentionCleanup(config: RetentionConfig): Promise<number> {
  if (!config.enabled) {
    return 0;
  }

  const cutoff = new Date(Date.now() - config.retentionDays * DAY_MS);
  let deletedCount = 0;

  for (let batch = 0; batch < config.maxBatchesPerRun; batch++) {
    const deletedInBatch = await deleteExpiredLogsBatch(
      cutoff,
      config.deleteBatchSize,
    );

    deletedCount += deletedInBatch;

    if (deletedInBatch < config.deleteBatchSize) {
      break;
    }

    await sleep(BATCH_PAUSE_MS);
  }

  return deletedCount;
}

export function startRetentionWorker(): NodeJS.Timeout | null {
  const config = getRetentionConfig();

  if (!config.enabled) {
    console.log("Log retention cleanup disabled");
    return null;
  }

  let cleanupRunning = false;

  const runCleanup = async (): Promise<void> => {
    if (cleanupRunning) {
      return;
    }

    cleanupRunning = true;

    try {
      const deletedCount = await runRetentionCleanup(config);

      if (deletedCount > 0) {
        console.log(`Deleted ${deletedCount} expired log rows`);
      }
    } catch (error) {
      console.error("Log retention cleanup failed:", error);
    } finally {
      cleanupRunning = false;
    }
  };

  const timer = setInterval(() => {
    void runCleanup();
  }, config.cleanupIntervalMs);

  timer.unref();

  console.log(
    `Log retention enabled: ${config.retentionDays} days, batch size ${config.deleteBatchSize}`,
  );

  void runCleanup();

  return timer;
}
