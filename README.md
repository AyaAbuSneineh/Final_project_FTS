# Log Ingestion and Query Service

A structured log ingestion, query, and aggregation service backed by PostgreSQL. Built to sustain high-volume ingestion and sub-second aggregation queries under fixed resource limits (0.5 CPU / 256 MB for the app, 1 CPU / 1 GB for Postgres).

## Contents

- [Quick start](#quick-start)
- [API documentation](#api-documentation)
- [Architecture](#architecture)
- [Schema and index design](#schema-and-index-design)
- [Attribute storage strategy](#attribute-storage-strategy)
- [Ingestion pipeline](#ingestion-pipeline)
- [Cursor pagination](#cursor-pagination)
- [Aggregation and rollups](#aggregation-and-rollups)
- [Retention strategy](#retention-strategy)
- [Optional features](#optional-features)
- [Configuration reference](#configuration-reference)
- [Testing](#testing)
- [Measured performance results](#measured-performance-results)
- [Known limitations](#known-limitations)

## Quick start

```bash
docker compose up
```

This builds the app image, starts Postgres, applies all database migrations automatically on boot, and starts the API on `localhost:8080`. `GET /health` returns `200` once the database connection is established, migrations have run, and the service is ready to accept traffic — `docker compose`'s `depends_on: condition: service_healthy` on Postgres and the app's own startup sequence (`connect` → `migrate` → `listen`) enforce that order.

No environment file or manual setup step is required. Every configuration value has a working default (see [Configuration reference](#configuration-reference)).

```bash
# ingest a batch
curl -X POST http://localhost:8080/logs \
  -H "Content-Type: application/json" \
  -d '{"logs":[{"timestamp":"2026-07-20T14:32:01.123Z","level":"error","service":"checkout","message":"payment declined","attributes":{"user_id":"42","region":"eu-west","retries":3}}]}'

# query
curl "http://localhost:8080/logs?service=checkout&level=error&limit=10"

# aggregate
curl "http://localhost:8080/logs/aggregate?since=2026-07-20T14:00:00Z&until=2026-07-20T15:00:00Z&bucket=5m&group_by=service"
```

## API documentation

### `GET /health`

Returns `200` with a JSON body once the database is reachable and migrations have applied. Returns `503` (`{"status":"unavailable"}`) if the database becomes unreachable after startup — the process itself stays up and recovers automatically once Postgres is reachable again.

### `POST /logs`

Accepts a batch (`{"logs": [...]}`, one entry minimum). Each entry is validated independently:

| Field | Rule |
|---|---|
| `timestamp` | required, ISO 8601, not more than 5 minutes in the future |
| `level` | required, one of `debug` / `info` / `warn` / `error` |
| `service` | required, non-empty string |
| `message` | required, non-empty string |
| `attributes` | optional, flat object of string/number/boolean values only |

An invalid entry never fails the batch — it is reported by index with a reason:

```json
{ "accepted": 9, "rejected": [{ "index": 3, "reason": "invalid level: 'critical'" }] }
```

- `200` when at least one entry is accepted.
- `400` when every entry is rejected, the JSON is malformed, or the top-level shape is wrong (missing/non-array `logs`).
- A `200` response is only ever returned after the batch has been durably written — see [Ingestion pipeline](#ingestion-pipeline).

### `GET /logs`

All parameters are optional and freely combinable: `service`, `level`, `since` (inclusive), `until` (exclusive), `attr.<key>` (string equality), `q` (case-insensitive substring on `message`), `limit` (1–1000, default 100), `cursor`.

Results are sorted by `timestamp DESC`, tie-broken by `id DESC` for a fully deterministic order. Response:

```json
{ "logs": [{ "id": "123", "timestamp": "...", "level": "error", "service": "checkout", "message": "...", "attributes": {"user_id": "42"} }], "next_cursor": "eyJpZCI6..." }
```

`next_cursor` is `null` when there is no further page. An unrecognized query parameter, invalid timestamp/level/limit, an inverted `since`/`until`, or a malformed cursor all return `400` as `{"error": "<description>"}`.

### `GET /logs/aggregate`

Same filters as `GET /logs` (`service`, `level`, `attr.<key>`, `q`), plus required `since`, `until`, `bucket` (`1m`/`5m`/`1h`/`1d`) and optional `group_by` (`service`/`level`). One row per non-empty `(bucket, group)` combination, ordered by bucket start ascending; `group` is `null` when `group_by` is omitted.

```json
{ "buckets": [{ "start": "2026-07-20T14:00:00Z", "group": "checkout", "count": 118 }] }
```

## Architecture

```
Client → Express (src/app.ts)
           ├─ POST /logs   → validators/log.validator → services/ingestion_batcher.service → repositories/logs.repository
           ├─ GET  /logs   → validators/query.validator → query-builders/logs.query-builder → repositories/logs.repository
           └─ GET  /logs/aggregate → validators/aggregate.validator → query-builders/aggregation.query-builder → repositories/logs.repository
Postgres (single source of truth) ← retention.service (periodic batched delete)
```

Controllers only translate HTTP ↔ typed calls; validation, query construction, and persistence each live in their own layer (`validators/`, `query-builders/`, `repositories/`), so the SQL for a given endpoint has exactly one place to look and one place to change.

Two separate `pg.Pool`s share the 1 GB Postgres budget: a small dedicated pool for ingestion flush workers, and a general pool for everything else (queries, retention, migrations). This means a burst of ingestion traffic cannot starve the connections that `GET /logs` and `GET /logs/aggregate` need to stay responsive.

## Schema and index design

```sql
logs (
  id               bigint PK, identity
  timestamp        timestamptz not null
  level             text not null   check in ('debug','info','warn','error')
  service          text not null   check length > 0
  message          text not null   check length > 0
  attributes       jsonb not null default '{}'   -- source of truth, mixed types
  attributes_text  jsonb not null default '{}'   -- every value re-expressed as text, see below
)

log_count_rollups_1m (
  bucket_start timestamptz, service text, level text, log_count bigint,
  PRIMARY KEY (bucket_start, service, level)
)
```

Indexes, each earning its place against a specific query shape:

| Index | Serves |
|---|---|
| `logs_timestamp_id_idx` (`timestamp desc, id desc`) | `GET /logs` with no `service` filter; also the tie-break for deterministic ordering and cursor pagination |
| `logs_service_timestamp_id_idx` (`service, timestamp desc, id desc`) | `GET /logs`/`aggregate` filtered by `service`, including a wide/absent time range |
| `logs_message_trgm_idx` (GIN, `gin_trgm_ops`) | `q` substring search (`ILIKE '%...%'`) — a plain btree can't accelerate a leading-wildcard match, trigram GIN can |
| `logs_attributes_text_gin_idx` (GIN, `jsonb_path_ops`) | `attr.<key>` equality filters — see [Attribute storage strategy](#attribute-storage-strategy) |
| `log_count_rollups_1m` PK | Serves aggregation directly; no extra index needed since the PK's leading column is `bucket_start` |

`EXPLAIN ANALYZE` on the two hot paths, at ~1.9M rows:

```
-- service + level filter, no attribute filter
Limit (actual time=0.129..1.069 rows=101) — Index Scan using logs_timestamp_id_idx, Execution Time: 1.09 ms
```

```
-- attr.<key> filter, after adding attributes_text + its GIN index (see below)
Bitmap Heap Scan on logs (actual time=0.038..0.084 rows=9)
  Recheck Cond: (attributes_text @> '{"user_id": "42"}')
  -> Bitmap Index Scan on logs_attributes_text_gin_idx (actual time=0.025..0.026 rows=9)
Execution Time: 0.13 ms
```

## Attribute storage strategy

The spec calls this out as one of the most important decisions, and it went through two iterations here.

**What's stored:** `attributes` is a single `jsonb` column holding the entry's arbitrary key/value map exactly as ingested (mixed string/number/boolean values) — this is the source of truth returned by `GET /logs`. A schemaless map in one column, rather than an EAV side table or per-key columns, was chosen because attribute keys are genuinely arbitrary per the spec (`user_id`, `request_id`, `region`, or anything else a caller sends) and a JSONB document scales to that without a migration per new key.

**The problem this caused:** the API contract requires `attr.<key>` to be **string equality**, so the natural query is `attributes ->> 'key' = 'value'`. A JSONB `->>` expression cannot be accelerated by *any* index type in Postgres — GIN indexes on JSONB only accelerate containment (`@>`) and key-existence (`?`) operators, not text-extraction equality. An earlier attempt at a GIN index on `attributes` (`jsonb_path_ops`, see `drizzle/0006`/`0008`) was correctly removed because the query never used it: `EXPLAIN` still showed a full index-then-filter scan. Measured on this branch before the fix, at ~1.9M rows: a bare `attr.user_id=42` filter took **3.85 s** (scanning all 1.92M rows via `logs_timestamp_id_idx` and filtering each one); combined with a `service` filter it still took **1.27 s** (scanning the ~385K rows in that service partition). Both are far outside any reasonable query budget, and both hold a connection from the small general pool for that entire time — a real risk to `GET /logs/aggregate`'s own latency budget under concurrent traffic.

**The fix:** a second column, `attributes_text jsonb`, computed once at write time — inside the same `INSERT ... SELECT` statement `insertLogChunk` already runs (`logs.repository.ts`), via `jsonb_each` + `jsonb_object_agg`, not in the application — by mapping every value in `attributes` to its string form (`3 → "3"`, `true → "true"`) — exactly the semantics `attr.<key>` equality already requires. A GIN index (`jsonb_path_ops`) on `attributes_text` *can* accelerate it, because the query is now rewritten as containment: all `attr.<key>=value` filters in a request collapse into a single `attributes_text @> '{"key1":"val1","key2":"val2"}'` check — one indexed probe regardless of how many attribute filters are combined. After the fix, the same `attr.user_id=42` query resolves in ~0.13 ms via a bitmap index scan instead of a multi-second sequential-style scan (see the `EXPLAIN ANALYZE` output above) — roughly a 25,000x improvement.

The trade-off: every insert now does a small amount of extra Postgres-side work (the `jsonb_each`/`jsonb_object_agg` conversion) and maintains one extra GIN index, and `attributes_text` is pure derived data, never returned by the API. That work was deliberately placed in SQL rather than in the request-handling code: an early version computed `attributes_text` in JavaScript before the insert, which measurably regressed sustained ingestion throughput (~14,700 → ~12,400 logs/sec) because the app container's 0.5 CPU allocation is the tighter budget of the two (it was already running at ~48% of its own cap under load) — `docker stats` showed Postgres, at ~43-66% of its 1 CPU allocation during the same runs, had headroom to absorb the extra work and the app didn't. Moving the computation into the insert statement restored throughput to baseline. `attributes` (the source of truth) is unaffected and unindexed by design — it's read-only for response serialization, never filtered directly.

## Ingestion pipeline

`POST /logs` does not insert one row per request. Validated entries are pushed onto an in-process queue (`ingestion_batcher.service.ts`) and flushed by a small pool of workers (`INGEST_FLUSH_CONCURRENCY`, default 2) either when the buffer crosses `INGEST_FLUSH_MAX_LOGS` or after `INGEST_FLUSH_INTERVAL_MS` (default 50 ms) — whichever comes first. This turns many small HTTP-sized batches into fewer, larger `INSERT ... SELECT * FROM unnest(...)` statements, which is dramatically cheaper per row than one `INSERT` per row or per HTTP batch.

Each request's promise resolves only after its data has actually been flushed and committed — **a `200` is never returned for a batch that wasn't durably written**, satisfying the "never ack what you haven't stored" requirement even though inserts are batched behind the scenes. If the buffer fills faster than it drains, `enqueueLogsForInsert` returns `503` (backpressure) rather than accepting unbounded work.

Within a flush, rows are chunked (`INSERT_CHUNK_SIZE`, default 5000) and each chunk's insert is paired, in the same statement, with an upsert into `log_count_rollups_1m` (see [Aggregation and rollups](#aggregation-and-rollups)) so the two are never allowed to drift apart.

A dedicated `pg.Pool` (2 connections) is reserved for these flush workers, separate from the pool used for queries — so a query surge can't starve ingestion and a write surge can't starve queries.

## Cursor pagination

The cursor encodes `(timestamp, id)` of the last row on the page as base64url JSON (`utils/cursor.ts`). The next page's condition is a single tuple comparison, `(timestamp, id) < (cursor.timestamp, cursor.id)`, which Postgres can satisfy directly from the `(timestamp desc, id desc)` index without an `OFFSET` — so page 200 costs the same as page 1. Every field is validated on decode (timestamp must parse, id must be a positive integer); anything else returns `400` rather than a confusing query result.

## Aggregation and rollups

`GET /logs/aggregate` has two execution paths:

- **No `q` and no `attr.<key>` filters** (`canUseRollups`): pre-aggregated per-minute counts in `log_count_rollups_1m` (maintained transactionally alongside every insert and every retention delete) are summed directly — the query touches rollup rows, not raw log rows, so its cost is independent of how many raw rows exist in that range.
- **With `q` or `attr.<key>` filters**: falls back to a raw `GROUP BY` over `logs` with the same date-bucketing expression (`date_bin`), since a substring or attribute filter can't be answered from a table that only stores counts.

Even the wider range in the no-rollup case is split so that any partial (sub-minute) edge bucket at the start/end of the requested range is computed from raw rows while the fully-contained middle is summed from rollups — so a `since`/`until` that doesn't fall on a clean minute boundary still gets a correct count.

## Retention strategy

Retention runs as an in-process timer (`RETENTION_CLEANUP_INTERVAL_MS`, default 15 min), deleting rows older than `LOG_RETENTION_DAYS` (default 30) in small batches (`RETENTION_DELETE_BATCH_SIZE`, default 5000) up to `RETENTION_MAX_BATCHES_PER_RUN` per tick, with a short pause between batches. Each batch:

- Selects candidate rows with `ORDER BY timestamp ASC LIMIT ... FOR UPDATE SKIP LOCKED` — bounded work per statement (no unbounded `DELETE FROM logs WHERE timestamp < ...` holding a long-running lock over the whole expired range), and rows currently locked by something else (e.g. a concurrent flush touching an adjacent row) are simply skipped this batch rather than blocked on.
- Decrements the matching `log_count_rollups_1m` bucket by exactly the rows that batch removed (never blindly zeroes a bucket, since the cutoff can fall mid-bucket), and drops any rollup row that reaches zero.

This keeps retention from competing with ingestion for long locks or large single transactions, at the cost of retention being "eventually complete" rather than instantaneous when a large backlog exists (bounded by `maxBatchesPerRun` per tick).

## Optional features

None of the stretch features (auth/API keys, multi-tenancy, rate limiting, dashboards, live-tail, etc.) are implemented. This means the zero-configuration default posture required by the grading contract holds trivially: `docker compose up` with no environment file serves all four endpoints unauthenticated, with no rate limit or tenancy restriction, and an `Authorization` header sent by the load generator is simply ignored (there is no auth middleware to reject it).

## Configuration reference

All variables have defaults; none are required for `docker compose up` to work. Set via environment variables (see `docker-compose.yml` for the values used at grading-relevant scale).

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `PORT` | `8080` | HTTP listen port |
| `DB_POOL_MAX` | `10` | Total Postgres connections (split 2 for ingestion / rest for queries) |
| `LOG_RETENTION_ENABLED` | `true` | Master switch for the retention worker |
| `LOG_RETENTION_DAYS` | `30` | Age at which rows become eligible for deletion |
| `RETENTION_CLEANUP_INTERVAL_MS` | `900000` | How often the retention worker ticks |
| `RETENTION_DELETE_BATCH_SIZE` | `5000` | Rows deleted per batch |
| `RETENTION_MAX_BATCHES_PER_RUN` | `20` | Batch cap per tick |
| `MAX_LOGS_PER_BATCH` | `10000` | Max entries accepted in one `POST /logs` body |
| `INSERT_CHUNK_SIZE` | `5000` | Rows per physical `INSERT` statement |
| `INGEST_BATCHING_ENABLED` | `true` | Disable to insert every request synchronously (no in-process buffering) |
| `INGEST_FLUSH_INTERVAL_MS` | `50` | Max time a log waits in the buffer before being flushed |
| `INGEST_FLUSH_MAX_LOGS` | `5000` | Buffer size that triggers an immediate flush |
| `INGEST_MAX_BUFFERED_LOGS` | `100000` | Buffer cap before `POST /logs` returns `503` |
| `INGEST_FLUSH_CONCURRENCY` | `2` | Parallel flush workers |
| `MAX_SERVICE_LENGTH` / `MAX_MESSAGE_LENGTH` | `256` / `8192` | Per-field length caps |
| `MAX_ATTRIBUTES_PER_LOG` | `50` | Max attribute keys per entry |
| `MAX_ATTRIBUTE_KEY_LENGTH` / `MAX_ATTRIBUTE_STRING_VALUE_LENGTH` | `128` / `4096` | Attribute key/value length caps |

## Testing

```bash
npm run test              # unit tests — pure logic, no database (72 tests)
docker compose up -d postgres
npm run test:integration  # full HTTP contract against a real Postgres (35 tests)
npm run typecheck
npm run build
```

CI (`.github/workflows/ci.yml`) runs both suites against a real Postgres service container, then brings up the full `docker compose` stack and smoke-tests all four required endpoints (health polling, a mixed valid/invalid ingest batch, a filtered query, an aggregate query, and a 400 on invalid input) exactly as the load generator would reach the service.

## Measured performance results

**Test environment:** Docker Desktop on Windows, containers resource-capped exactly as in `docker-compose.yml` (app: 0.5 CPU / 256 MB, Postgres: 1 CPU / 1 GB). Load generated by `scripts/loadtest.ts`, a standalone Node client external to the containers (not part of the graded API surface). All numbers below are from the final build (`attributes_text` computed in the insert statement, GIN-indexed).

**Dataset size:** 1,200,001 rows at time of the final measurements below (multiple ingestion runs against the same table, spread over a simulated ~1 month of timestamps).

**Ingestion throughput** (batch size 1000, 60 concurrent clients):

| Rows sent | Elapsed | Throughput |
|---|---|---|
| 1,000,000 | 67.6 s | 14,782 logs/sec sustained |
| 200,000 | 14.0 s | 14,249 logs/sec |
| 150,000 | 7.4 s | 20,375 logs/sec (short burst, before write-amplification catches up) |

No failed batches, no crashes, at any concurrency tested (20–60 clients), across ten separate load-test runs totaling well over 2 million ingested rows during development of this feature.

**Resource usage during a sustained 1M-row burst** (`docker stats`): app container ~48% CPU (of its 0.5-core cap — the app is the ingestion throughput ceiling, not Postgres), ~87 MB / 256 MB memory; Postgres ~66% CPU (of its 1-core cap — up from ~43% before the `attributes_text` GIN index existed, but still with headroom), ~116–372 MB / 1 GB memory.

**Aggregate query latency**, `GET /logs/aggregate?bucket=1m&group_by=service` over a multi-hour window, ~1.2M rows in the table:

| Condition | p50 | p95 | p99 |
|---|---|---|---|
| Idle (no concurrent ingestion) | 33.3 ms | 53.2 ms | 162.9 ms |
| During sustained concurrent ingestion (steady state) | 211 ms | 259 ms | 275 ms |

Both are comfortably under the 1 s p95 target. `GET /logs` under the same concurrent-ingestion condition: p50 143 ms, p95 169 ms, p99 176 ms.

**Bottleneck found — cold-start latency spike:** the very first `GET /logs/aggregate` (or `/logs`) issued within ~1–3 seconds of a *fresh* burst of concurrent ingestion beginning (60 clients starting simultaneously) sees an outsized latency spike (7–30 s, reproduced across six independent runs), before settling into the steady-state numbers above within ~15–20 seconds. This is not explained by cold caches (Postgres was already warm in every case). It's consistent with request-handling queueing on the single Node process: the app container is capped at 0.5 CPU and briefly saturated (confirmed via `docker stats`, ~48-49% of the container's own 0.5-core allocation) the instant dozens of concurrent `POST /logs` bodies need parsing at once, delaying when the event loop gets to service an unrelated `GET` that arrived in the same window. It self-resolves without intervention and does not recur once the burst is in steady state — but it is a real, measured limitation of a single-process app pinned to 0.5 CPU, not a hypothetical one. See [Known limitations](#known-limitations).

**Attribute filter fix, before/after** (see [Attribute storage strategy](#attribute-storage-strategy)): `attr.user_id=<value>` alone, ~1.92M rows, `EXPLAIN ANALYZE` execution time — **3.85 s before**, **0.13 ms after** adding the `attributes_text` GIN index (~25,000x).

**Secondary finding — checkpoint frequency under sustained writes:** Postgres logged `checkpoints are occurring too frequently (29 seconds apart)` during the heaviest burst, i.e. `max_wal_size` (left at its default) is undersized for this write rate. Not addressed here — the container still met every throughput and latency target as measured — but tuning `max_wal_size`/`checkpoint_completion_target` would likely reduce write-path I/O spikes at sustained 15k+ logs/sec over longer periods than tested here.

## Known limitations

- **No authentication, multi-tenancy, or rate limiting.** Everything is a single unauthenticated tenant. Acceptable per the assignment's "zero configuration" default posture, but a real multi-team deployment would need at least API keys.
- **Cold-start latency spike under sudden concurrent load**, described above — a consequence of the 0.5 CPU cap on a single Node process; a second app replica or worker-thread pool for JSON parsing would likely smooth this out, not attempted here given the time budget.
- **`attributes_text` migration does not backfill pre-existing rows.** A table already holding a large volume of data before this column was introduced would need an out-of-band, batched backfill (the same pattern retention already uses) rather than a single blocking `UPDATE` inside the migration — a naive single-statement backfill was tried and found to be a genuine risk (a long-running write competing with live traffic, see `drizzle/0010`'s comment). Not an issue for a fresh `docker compose up`, since the migration runs before any data exists.
- **No dead-letter storage for rejected log entries** — rejections are reported synchronously in the ingest response and then discarded; a caller that doesn't inspect `rejected` loses that data permanently.
- **Retention is time-only.** There's no size-based cap — a sustained ingestion rate far above the configured retention window's expected volume could grow the table faster than retention reclaims it.
- **Single Postgres instance.** All reads and writes hit one instance, as required by the assignment, so it is the ultimate ceiling on both ingestion and query throughput; no read replica or sharding.
- **Default WAL/checkpoint tuning.** `max_wal_size` and related settings are left at Postgres defaults; a sustained (not just burst) 15k+ logs/sec workload over a longer period than tested here would likely benefit from tuning them (see the checkpoint-frequency warning noted in [Measured performance results](#measured-performance-results)).
