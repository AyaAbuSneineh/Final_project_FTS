import { ingestionConfig } from "../config/ingestion.config.js";
import { ServiceUnavailableError } from "../errors.js";
import { insertLogs } from "../repositories/logs.repository.js";

import type { ValidLogInput } from "../types.js";

interface PendingInsert {
  logs: ValidLogInput[];
  resolve: () => void;
  reject: (error: unknown) => void;
}

const pendingInserts: PendingInsert[] = [];

let bufferedLogCount = 0;
let flushTimer: NodeJS.Timeout | null = null;
let activeFlushWorkers = 0;

function scheduleFlush(): void {
  if (flushTimer !== null) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    startFlushWorkers();
  }, ingestionConfig.flushIntervalMs);

  flushTimer.unref();
}

function takeFlushBatch(): {
  items: PendingInsert[];
  logs: ValidLogInput[];
} {
  const items: PendingInsert[] = [];
  const logs: ValidLogInput[] = [];
  let selectedLogCount = 0;

  while (pendingInserts.length > 0) {
    const nextItem = pendingInserts[0]!;

    if (
      selectedLogCount > 0 &&
      selectedLogCount + nextItem.logs.length > ingestionConfig.flushMaxLogs
    ) {
      break;
    }

    pendingInserts.shift();
    bufferedLogCount -= nextItem.logs.length;
    selectedLogCount += nextItem.logs.length;
    items.push(nextItem);
    logs.push(...nextItem.logs);
  }

  return {
    items,
    logs,
  };
}

// Each worker independently drains the shared queue until it's empty. Dequeuing
// (takeFlushBatch) is synchronous, so concurrent workers can never take the same
// items — only the `await insertLogs(...)` below actually runs concurrently across
// workers, each on its own pool connection.
async function runFlushWorker(): Promise<void> {
  activeFlushWorkers++;

  try {
    while (pendingInserts.length > 0) {
      const batch = takeFlushBatch();

      if (batch.items.length === 0) {
        break;
      }

      try {
        await insertLogs(batch.logs);

        for (const item of batch.items) {
          item.resolve();
        }
      } catch (error) {
        for (const item of batch.items) {
          item.reject(error);
        }
      }
    }
  } finally {
    activeFlushWorkers--;
  }
}

function startFlushWorkers(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  while (
    activeFlushWorkers < ingestionConfig.maxConcurrentFlushes &&
    pendingInserts.length > 0
  ) {
    void runFlushWorker();
  }
}

export async function enqueueLogsForInsert(logs: ValidLogInput[]): Promise<void> {
  if (!ingestionConfig.batchingEnabled) {
    await insertLogs(logs);
    return;
  }

  if (bufferedLogCount + logs.length > ingestionConfig.maxBufferedLogs) {
    throw new ServiceUnavailableError("ingestion buffer is full");
  }

  await new Promise<void>((resolve, reject) => {
    pendingInserts.push({
      logs,
      resolve,
      reject,
    });

    bufferedLogCount += logs.length;

    if (bufferedLogCount >= ingestionConfig.flushMaxLogs) {
      startFlushWorkers();
      return;
    }

    scheduleFlush();
  });
}

/** Drains all buffered logs, waiting for every in-flight and queued insert to settle. Used for graceful shutdown. */
export async function drainPendingInserts(): Promise<void> {
  startFlushWorkers();

  while (pendingInserts.length > 0 || activeFlushWorkers > 0) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
