/**
 * Standalone load-test driver used to produce the measured numbers in the README.
 * Not part of the graded API surface — a dev tool only.
 *
 * Usage: BASE_URL=http://localhost:18080 npx tsx scripts/loadtest.ts
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const TARGET_ROWS = Number(process.env.LOADTEST_ROWS ?? 1_000_000);
const BATCH_SIZE = Number(process.env.LOADTEST_BATCH_SIZE ?? 500);
const CONCURRENCY = Number(process.env.LOADTEST_CONCURRENCY ?? 20);

const SERVICES = ["checkout", "auth", "payments", "inventory", "notifications"];
const LEVELS = ["debug", "info", "warn", "error"] as const;
const REGIONS = ["eu-west", "us-east", "ap-south"];
const MESSAGES = [
  "payment declined",
  "request completed",
  "connection timeout",
  "cache miss",
  "user logged in",
  "rate limit exceeded",
  "retrying request",
  "database query slow",
];

function randomOf<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function makeBatch(size: number, baseTime: number): unknown[] {
  const logs = [];
  for (let i = 0; i < size; i++) {
    logs.push({
      timestamp: new Date(baseTime - Math.floor(Math.random() * 1000)).toISOString(),
      level: randomOf(LEVELS),
      service: randomOf(SERVICES),
      message: randomOf(MESSAGES),
      attributes: {
        user_id: String(Math.floor(Math.random() * 100_000)),
        region: randomOf(REGIONS),
        retries: Math.floor(Math.random() * 5),
      },
    });
  }
  return logs;
}

async function postBatch(size: number): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now();
  const response = await fetch(`${BASE_URL}/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ logs: makeBatch(size, Date.now()) }),
  });
  await response.json();
  const ms = performance.now() - start;
  return { ok: response.status === 200, ms };
}

async function measureAggregateLatency(): Promise<number[]> {
  const now = new Date();
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const until = now.toISOString();
  const latencies: number[] = [];

  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    const response = await fetch(
      `${BASE_URL}/logs/aggregate?since=${since}&until=${until}&bucket=1m&group_by=service`,
    );
    await response.json();
    latencies.push(performance.now() - start);
    if (!response.ok) {
      console.error("aggregate request failed", response.status);
    }
  }

  return latencies;
}

function percentile(sorted: number[], p: number): number {
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))]!;
}

async function runIngestionLoad(): Promise<void> {
  const totalBatches = Math.ceil(TARGET_ROWS / BATCH_SIZE);
  let sent = 0;
  let batchesDone = 0;
  let failures = 0;
  const overallStart = performance.now();

  let nextBatch = 0;

  async function worker(): Promise<void> {
    while (nextBatch < totalBatches) {
      const myBatch = nextBatch++;
      const size = Math.min(BATCH_SIZE, TARGET_ROWS - myBatch * BATCH_SIZE);
      if (size <= 0) break;

      try {
        const { ok } = await postBatch(size);
        if (!ok) failures++;
        sent += size;
      } catch {
        failures++;
      }

      batchesDone++;
      if (batchesDone % 200 === 0) {
        const elapsedSec = (performance.now() - overallStart) / 1000;
        console.log(
          `progress: ${sent}/${TARGET_ROWS} rows, ${(sent / elapsedSec).toFixed(0)} logs/sec so far`,
        );
      }
    }
  }

  console.log(
    `Starting ingestion load: ${TARGET_ROWS} rows, batch=${BATCH_SIZE}, concurrency=${CONCURRENCY}`,
  );

  const workers = Array.from({ length: CONCURRENCY }, () => worker());
  await Promise.all(workers);

  const elapsedSec = (performance.now() - overallStart) / 1000;
  console.log("--- Ingestion summary ---");
  console.log(`rows sent: ${sent}`);
  console.log(`failed batches: ${failures}`);
  console.log(`elapsed: ${elapsedSec.toFixed(1)}s`);
  console.log(`throughput: ${(sent / elapsedSec).toFixed(0)} logs/sec`);
}

async function runAggregateLatencyProbe(): Promise<void> {
  const latencies = (await measureAggregateLatency()).sort((a, b) => a - b);
  console.log("--- Aggregate query latency (ms), 20 samples ---");
  console.log(`p50: ${percentile(latencies, 50).toFixed(1)}`);
  console.log(`p95: ${percentile(latencies, 95).toFixed(1)}`);
  console.log(`p99: ${percentile(latencies, 99).toFixed(1)}`);
  console.log(`max: ${latencies[latencies.length - 1]!.toFixed(1)}`);
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? "ingest";

  if (mode === "ingest") {
    await runIngestionLoad();
  } else if (mode === "aggregate") {
    await runAggregateLatencyProbe();
  } else if (mode === "both") {
    await runIngestionLoad();
    await runAggregateLatencyProbe();
  } else {
    console.error(`unknown mode: ${mode} (expected ingest | aggregate | both)`);
    process.exit(1);
  }
}

void main();
