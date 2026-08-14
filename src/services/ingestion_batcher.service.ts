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
let flushRunning = false;

function scheduleFlush(): void {
  if (flushTimer !== null || flushRunning) {
    return;
  }

  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPendingLogs();
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

async function flushPendingLogs(): Promise<void> {
  if (flushRunning || pendingInserts.length === 0) {
    return;
  }

  flushRunning = true;

  try {
    while (pendingInserts.length > 0) {
      const batch = takeFlushBatch();

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
    flushRunning = false;

    if (pendingInserts.length > 0) {
      scheduleFlush();
    }
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
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }

      void flushPendingLogs();
      return;
    }

    scheduleFlush();
  });
}
