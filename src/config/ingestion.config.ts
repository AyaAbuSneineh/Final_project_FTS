
export interface IngestionConfig {
  maxLogsPerBatch: number;
  insertChunkSize: number;
  batchingEnabled: boolean;
  flushIntervalMs: number;
  flushMaxLogs: number;
  maxBufferedLogs: number;
  maxConcurrentFlushes: number;
  maxServiceLength: number;
  maxMessageLength: number;
  maxAttributesPerLog: number;
  maxAttributeKeyLength: number;
  maxAttributeStringValueLength: number;
}

const DEFAULT_MAX_LOGS_PER_BATCH = 10_000;
const DEFAULT_INSERT_CHUNK_SIZE = 5_000;
const DEFAULT_BATCHING_ENABLED = true;
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const DEFAULT_FLUSH_MAX_LOGS = 7_500;
const DEFAULT_MAX_BUFFERED_LOGS = 100_000;
// A single Postgres CPU core cannot truly parallelize CPU-bound work, so this
// stays small: enough to stop one slow flush from head-of-line-blocking every
// other request, not so many that they just add lock/context-switch contention.
const DEFAULT_MAX_CONCURRENT_FLUSHES = 2;
const DEFAULT_MAX_SERVICE_LENGTH = 256;
const DEFAULT_MAX_MESSAGE_LENGTH = 8_192;
const DEFAULT_MAX_ATTRIBUTES_PER_LOG = 50;
const DEFAULT_MAX_ATTRIBUTE_KEY_LENGTH = 128;
const DEFAULT_MAX_ATTRIBUTE_STRING_VALUE_LENGTH = 4_096;

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

function getIngestionConfig(): IngestionConfig {
  const maxLogsPerBatch = parsePositiveIntegerEnv(
    "MAX_LOGS_PER_BATCH",
    DEFAULT_MAX_LOGS_PER_BATCH,
  );

  const insertChunkSize = parsePositiveIntegerEnv(
    "INSERT_CHUNK_SIZE",
    DEFAULT_INSERT_CHUNK_SIZE,
  );

  if (insertChunkSize > maxLogsPerBatch) {
    throw new Error("INSERT_CHUNK_SIZE must not be greater than MAX_LOGS_PER_BATCH");
  }

  return {
    maxLogsPerBatch,
    insertChunkSize,
    batchingEnabled: parseBooleanEnv(
      "INGEST_BATCHING_ENABLED",
      DEFAULT_BATCHING_ENABLED,
    ),
    flushIntervalMs: parsePositiveIntegerEnv(
      "INGEST_FLUSH_INTERVAL_MS",
      DEFAULT_FLUSH_INTERVAL_MS,
    ),
    flushMaxLogs: parsePositiveIntegerEnv(
      "INGEST_FLUSH_MAX_LOGS",
      DEFAULT_FLUSH_MAX_LOGS,
    ),
    maxBufferedLogs: parsePositiveIntegerEnv(
      "INGEST_MAX_BUFFERED_LOGS",
      DEFAULT_MAX_BUFFERED_LOGS,
    ),
    maxConcurrentFlushes: parsePositiveIntegerEnv(
      "INGEST_FLUSH_CONCURRENCY",
      DEFAULT_MAX_CONCURRENT_FLUSHES,
    ),
    maxServiceLength: parsePositiveIntegerEnv(
      "MAX_SERVICE_LENGTH",
      DEFAULT_MAX_SERVICE_LENGTH,
    ),
    maxMessageLength: parsePositiveIntegerEnv(
      "MAX_MESSAGE_LENGTH",
      DEFAULT_MAX_MESSAGE_LENGTH,
    ),
    maxAttributesPerLog: parsePositiveIntegerEnv(
      "MAX_ATTRIBUTES_PER_LOG",
      DEFAULT_MAX_ATTRIBUTES_PER_LOG,
    ),
    maxAttributeKeyLength: parsePositiveIntegerEnv(
      "MAX_ATTRIBUTE_KEY_LENGTH",
      DEFAULT_MAX_ATTRIBUTE_KEY_LENGTH,
    ),
    maxAttributeStringValueLength: parsePositiveIntegerEnv(
      "MAX_ATTRIBUTE_STRING_VALUE_LENGTH",
      DEFAULT_MAX_ATTRIBUTE_STRING_VALUE_LENGTH,
    ),
  };
}

export const ingestionConfig = getIngestionConfig();
