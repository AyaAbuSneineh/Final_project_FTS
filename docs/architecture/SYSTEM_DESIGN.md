# System Design Notes

# 1. Design Principles

The current system design is based on the following principles:

* Minimize database round trips.
* Keep write operations efficient.
* Build only what is required.
* Separate responsibilities between layers.
* Optimize for the expected workload.
* Avoid premature optimization.
* Validate performance decisions through load testing.
* Keep PostgreSQL as the source of truth.
* Make future scaling possible without overengineering the initial implementation.

---

# 2. Current Architecture

The initial architecture will remain intentionally simple.

```text
Client
  |
  v
HTTP Controller
  |
  v
Service
  |------ Validator
  |
  |------ Query Builder
  |
  v
Repository
  |
  v
PostgreSQL Connection Pool
  |
  v
PostgreSQL
```

The application process will also contain a lightweight retention worker.

```text
Application
├── HTTP Server
└── Retention Worker
```

No additional infrastructure such as Redis, RabbitMQ, or separate worker services will be introduced initially.

---

# 3. Database

## Selected Database

### Decision

Use PostgreSQL.

### Reasoning

* Required by the project specification.
* Strong indexing support.
* ACID transactions.
* Strong aggregation and filtering capabilities.
* Native JSONB support.
* Suitable for mixed read/write workloads.
* Supports advanced performance analysis using `EXPLAIN` and `EXPLAIN ANALYZE`.

PostgreSQL will remain the source of truth for both reads and writes.

---

# 4. Log Storage Strategy

## Decision

Use hybrid storage.

Fixed log fields will be stored as regular relational columns.

Example fields:

* id
* timestamp
* level
* service
* message

Dynamic attributes will be stored inside a JSONB column.

Example:

```json
{
  "user_id": "42",
  "region": "eu-west",
  "retries": 3
}
```

### Reasoning

Benefits of fixed columns:

* Frequently queried.
* Stable schema.
* Easier indexing.
* Efficient filtering and sorting.

Benefits of JSONB:

* Flexible schema.
* Supports arbitrary attributes.
* No schema migration required when new attribute keys appear.
* Native PostgreSQL support.
* Can be indexed if performance testing demonstrates a need.

This provides a balance between relational query performance and schema flexibility.

---

# 5. Initial Database Schema

The initial logical schema will be similar to:

```text
logs
---------------------------------
id           BIGINT
timestamp    TIMESTAMPTZ
level        TEXT
service      TEXT
message      TEXT
attributes   JSONB
```

## Database Constraints

Application validation will remain the primary validation mechanism.

Database constraints will provide an additional safety layer.

Expected constraints include:

* `id` generated automatically.
* `timestamp NOT NULL`
* `level NOT NULL`
* `service NOT NULL`
* `message NOT NULL`
* `attributes NOT NULL DEFAULT '{}'`
* A database-level constraint may restrict `level` to:

  * debug
  * info
  * warn
  * error

Database constraints are not intended to replace application validation.

---

# 6. Primary Key Strategy

## Decision

Use:

```sql
BIGINT GENERATED ALWAYS AS IDENTITY
```

as the primary identifier.

### Reasoning

* Faster inserts than random UUID identifiers.
* Smaller indexes.
* Good B-tree locality.
* Efficient storage.
* Useful for deterministic ordering together with timestamp.
* BIGINT provides more than enough identifier space for this project.

The API may expose the identifier as a string to avoid JavaScript integer precision limitations.

---

# 7. Attribute Storage and Filtering

## Decision

Store original attributes as JSONB while preserving their JSON types.

Example:

```json
{
  "user_id": "42",
  "retries": 3,
  "premium": true
}
```

The API contract requires attribute equality to be compared as strings.

Therefore, filtering will conceptually use PostgreSQL text extraction behavior such as:

```sql
attributes ->> key
```

Example:

```text
attr.retries=3
```

will compare the extracted JSONB value as the text value `"3"`.

## JSONB Indexing Strategy

The exact JSONB indexing approach will not be fixed before benchmarking.

Possible future optimizations include:

* GIN indexing.
* Expression indexes for proven high-frequency attribute keys.
* Additional normalized searchable representations.

These will only be introduced if measured query performance demonstrates a need.

---

# 8. Validation Strategy

## Decision

Validation happens before inserting logs into PostgreSQL.

Each ingestion batch will be processed as follows:

1. Validate the top-level request structure.
2. Validate every log entry independently.
3. Separate valid and invalid entries.
4. Insert only valid entries.
5. Return rejected entries with their original array index and reason.

### Reasoning

* Required by the API contract.
* Invalid entries must not reject valid entries in the same batch.
* Avoids unnecessary database operations.
* Prevents avoidable database errors.
* Makes partial batch acceptance possible.

Malformed JSON or invalid top-level request structures return HTTP 400.

---

# 9. Insert Strategy

## Initial Decision

Use bulk insertion rather than inserting logs individually.

Conceptually:

```text
HTTP Batch
    |
    v
Validation
    |
    v
Valid Entries
    |
    v
Single Bulk Database Operation
    |
    v
PostgreSQL
```

### Reasoning

* Reduces database round trips.
* Reduces per-query overhead.
* Improves throughput.
* Better matches the expected ingestion workload.

The initial implementation will use multi-row bulk INSERT.

---

# 10. Bulk INSERT vs PostgreSQL COPY

## Status

Open performance decision.

### Initial Approach

Start with multi-row INSERT.

Example conceptually:

```sql
INSERT INTO logs (...)
VALUES
(...),
(...),
(...);
```

### Optimization Strategy

If measured ingestion throughput does not reach the required target, PostgreSQL `COPY` will be evaluated.

Decision process:

```text
Bulk INSERT
     |
     v
Load Test
     |
     +---- target reached ---> keep design
     |
     +---- target missed ----> evaluate COPY
```

COPY will therefore be treated as a measured optimization, not an architectural requirement.

---

# 11. Transaction Strategy

## Initial Decision

A single bulk INSERT does not require an explicit application-managed transaction.

PostgreSQL statements are atomic.

Therefore:

```text
Validated Batch
      |
      v
Single Bulk INSERT
```

is sufficient initially.

Explicit transactions will only be introduced if ingestion later requires multiple dependent database operations.

---

# 12. Reliability and Durability

## Decision

The service must never acknowledge logs before they have been safely persisted.

The application will not return successful ingestion merely because logs have entered an in-memory queue.

Expected flow:

```text
Request
   |
   v
Validate
   |
   v
Persist in PostgreSQL
   |
   v
Database operation succeeds
   |
   v
Return HTTP 200
```

### Reasoning

A successful response must represent durable acceptance.

An application crash immediately after returning HTTP 200 must not cause acknowledged logs to disappear.

---

# 13. Query Strategy

The API supports freely combinable filters such as:

* service
* level
* since
* until
* message search
* arbitrary attributes
* cursor
* limit

## Decision

Use a dynamic query builder.

The query builder will construct SQL conditions depending on the filters supplied by the client.

---

# 14. Dynamic SQL Security

## Decision

Never concatenate user-provided values directly into SQL.

All user values will be passed through parameterized queries.

Example:

```sql
service = $1
```

rather than constructing:

```text
service = '<user input>'
```

Dynamic SQL structure may be built using application-controlled SQL fragments.

For example:

```text
service filter
→ "service = $1"

level filter
→ "level = $2"
```

These trusted fragments may be combined dynamically.

### Dynamic Identifiers

SQL identifiers such as aggregation grouping columns cannot be safely parameterized in the same way as values.

Therefore they will be selected through strict whitelists.

Example:

```text
group_by=service → service

group_by=level → level

anything else → HTTP 400
```

No user-provided SQL identifier will be inserted directly into a query.

---

# 15. Query Builder Responsibility

## Decision

Separate dynamic query construction from database execution.

### Query Builder

Responsible for:

* Translating validated filters into SQL conditions.
* Managing parameter positions.
* Creating parameter arrays.
* Mapping trusted aggregation options.
* Building pagination conditions.

### Repository

Responsible for:

* Executing database queries.
* Using the PostgreSQL connection pool.
* Returning database results.
* Mapping persistence results when necessary.

This keeps query construction separate from HTTP handling and persistence execution.

---

# 16. Layered Architecture

## Decision

Use the following separation:

```text
Controller
    |
    v
Service
    |
    v
Repository
    |
    v
Database
```

Supporting components:

```text
Validator
Query Builder
Configuration
Database Pool
Retention Worker
```

## Controller Responsibilities

* HTTP concerns.
* Request parsing.
* Calling services.
* HTTP status codes.
* Response formatting.

Controllers should remain thin.

## Service Responsibilities

* Business logic.
* Workflow orchestration.
* Validation coordination.
* Deciding how repository operations are used.

## Repository Responsibilities

* Database access.
* Executing SQL.
* Bulk persistence.
* Query execution.

## Query Builder Responsibilities

* Construct dynamic SQL safely.
* Generate query parameters.
* Apply trusted whitelisted SQL fragments.

---

# 17. Time Range Semantics

The API contract defines:

```text
since → inclusive
until → exclusive
```

Therefore queries will use:

```sql
timestamp >= since
timestamp < until
```

Invalid time ranges, including `until < since`, return HTTP 400.

---

# 18. Message Search Strategy

## Required Behavior

The `q` parameter performs a case-insensitive substring search over the message.

## Initial Decision

Use PostgreSQL substring matching conceptually equivalent to:

```sql
message ILIKE '%query%'
```

## Optimization Candidate

Standard B-tree indexes are generally not suitable for leading-wildcard substring searches.

If load testing shows message search to be a bottleneck, PostgreSQL `pg_trgm` and a trigram index will be evaluated.

The trigram index will not be introduced automatically because additional indexes increase ingestion cost and storage usage.

---

# 19. Cursor-Based Pagination

## Decision

Use keyset/cursor pagination rather than OFFSET pagination.

The cursor will be based on:

```text
(timestamp, id)
```

### Sorting

Results will be ordered by:

```text
timestamp DESC
id DESC
```

This guarantees deterministic ordering even when many logs share the same timestamp.

### Cursor Behavior

The cursor will be opaque to the client.

Internally it may contain:

```json
{
  "timestamp": "2026-07-20T14:32:01.123Z",
  "id": "983425"
}
```

and be encoded using a URL-safe representation such as Base64URL.

### Next Page

The next page condition will conceptually use:

```text
(timestamp, id) < cursor values
```

under descending ordering.

### Determining next_cursor

For requested limit `N`, the query may retrieve:

```text
N + 1
```

rows.

If more than N rows exist:

* Return N rows.
* Generate `next_cursor`.

Otherwise:

```json
"next_cursor": null
```

Malformed or invalid cursors return HTTP 400.

---

# 20. Aggregation Design

## Decision

Use real-time aggregation queries directly against the logs table.

### Reasoning

The expected dataset is approximately one million rows and the expected aggregation request rate is limited.

Real-time aggregation provides:

* Simpler architecture.
* Up-to-date results.
* No synchronization complexity.
* No additional worker pipeline.
* No rollup maintenance.

Pre-aggregated rollup tables will only be considered if performance measurements show real-time aggregation cannot satisfy the latency target.

---

# 21. Aggregation Safety

Supported bucket values are fixed:

* 1m
* 5m
* 1h
* 1d

These values will be mapped internally to trusted SQL expressions.

Clients cannot provide arbitrary SQL intervals.

Supported `group_by` values are:

* service
* level

These values will also use a strict whitelist.

Anything outside the supported values will return HTTP 400.

---

# 22. Initial Index Strategy

## Principle

Indexes will be aligned with actual query patterns and verified using:

* `EXPLAIN`
* `EXPLAIN ANALYZE`
* load testing

Too many indexes reduce ingestion performance because every INSERT must update every relevant index.

Therefore the initial schema will keep indexes minimal.

## Initial Candidate

A strong initial candidate is an index supporting:

```text
(timestamp, id)
```

because this combination is used for:

* Time filtering.
* Descending log queries.
* Cursor pagination.
* Deterministic ordering.

Another possible candidate is:

```text
(service, timestamp, id)
```

because service filtering is expected to be common.

Other indexes will remain performance-driven decisions.

---

# 23. Indexes Not Yet Finalized

The following should be evaluated rather than automatically added:

* level index
* JSONB GIN index
* attribute expression indexes
* message trigram index
* additional composite indexes

### Reasoning

`level` has very low cardinality.

JSONB indexes may increase write cost significantly.

Message indexes may improve search but reduce ingestion throughput.

The final set of indexes will therefore be based on measured query plans and load-test results.

---

# 24. Caching Strategy

## Decision

No caching in the initial architecture.

### Reasoning

* High write frequency.
* Data changes continuously.
* Large number of possible filter combinations.
* Cache invalidation adds significant complexity.
* PostgreSQL should first be optimized directly.

Caching may be considered later only if measurements identify a useful and stable cacheable workload.

---

# 25. Database Connection Management

## Decision

Use a PostgreSQL connection pool with a controlled number of connections.

### Reasoning

Creating a database connection for each HTTP request is expensive.

A controlled pool provides:

* Reusable database connections.
* Lower connection overhead.
* Controlled database concurrency.
* Better behavior under high request rates.

Pool size will remain configurable and will be tuned through load testing.

The initial pool should remain relatively small because PostgreSQL is limited to 1 CPU and 1 GB RAM.

---

# 26. Retention Strategy

## Initial Decision

Use configurable time-based retention.

Example configuration:

```text
RETENTION_DAYS=30
```

Logs are considered expired when their timestamp is older than the configured retention period.

### Reasoning

Time-based retention directly matches the concept of expired logs.

It avoids unexpectedly deleting recent logs merely because a row-count or database-size threshold has been reached.

---

# 27. Retention Implementation

## Decision

Use a lightweight background retention worker.

The worker will periodically delete expired logs in small batches.

Conceptually:

```text
Find oldest expired logs
        |
        v
Delete small batch
        |
        v
Commit
        |
        v
Repeat later
```

### Reasoning

A single huge DELETE operation may create:

* Long transactions.
* WAL spikes.
* Excessive table bloat.
* Resource spikes.
* Ingestion disruption.

Small batches reduce the operational impact of retention.

Exact batch size and execution interval will be determined through testing.

---

# 28. Partitioning Strategy

## Initial Decision

Do not partition the logs table in the initial implementation.

### Reasoning

The expected workload is approximately one million stored records.

At this scale, PostgreSQL should first be tested using:

* A single table.
* Appropriate indexes.
* Batched retention.
* Efficient queries.

Partitioning introduces additional complexity involving:

* Partition management.
* Partition creation.
* Primary and unique constraints.
* Index management.
* Retention boundaries.
* Migrations.
* Testing.

## Future Optimization

Time-based partitioning remains a possible optimization if benchmarks demonstrate that:

* Retention deletion creates unacceptable overhead.
* Query pruning would meaningfully improve latency.
* Dataset growth becomes significantly larger than the initial target.

Partitioning is therefore a future optimization candidate rather than part of the initial architecture.

---

# 29. Storage and Row Count Limits

## Decision

Database size limits or maximum row-count limits will not be part of the default core retention behavior.

### Reasoning

Automatically deleting logs because a size or count threshold is exceeded could delete records that have not expired.

If storage-based or count-based policies are implemented later, they should be optional and disabled by default.

---

# 30. Health Check

## Decision

The application reports healthy only after:

* PostgreSQL connection has been established.
* Database migrations have completed successfully.
* Required startup initialization has completed.
* The application is ready to ingest logs.

Expected startup flow:

```text
Application starts
      |
      v
Connect PostgreSQL
      |
      v
Run migrations
      |
      v
Initialize services
      |
      v
Ready
      |
      v
GET /health → HTTP 200
```

A process merely running does not mean the service is healthy.

---

# 31. Docker Architecture

## Decision

Use Docker Compose with only the required core services.

```text
docker-compose
│
├── app
│   └── TypeScript service
│       port 8080
│
└── postgres
    └── PostgreSQL
```

The application container will expose port 8080 as:

```text
localhost:8080
```

The complete system must start using:

```bash
docker compose up
```

No manual migration step, `.env` setup, or administrative initialization should be required for the default configuration.

---

# 32. Optional Infrastructure

The initial architecture will not use:

* Redis
* RabbitMQ
* Kafka
* Kubernetes
* Separate ingestion workers
* Separate retention containers

### Reasoning

These components are not necessary for the initial workload and would increase operational complexity.

They will only be considered if measurements demonstrate a concrete requirement.

---

# 33. Authentication and Rate Limiting

## Initial Decision

Do not implement authentication, API keys, multi-tenancy, or rate limiting in the initial core implementation.

### Reasoning

The project requires zero-configuration access to the required API contract.

Core performance and reliability have higher priority.

If these features are implemented later:

* They must be disabled by default.
* They must not break the required API contract.
* They must follow the project's optional-feature rules.

---

# 34. Testing Strategy

Testing will be divided into multiple levels.

## Unit Tests

Examples:

* Log validation.
* Timestamp validation.
* Attribute validation.
* Query parameter validation.
* Cursor encode/decode.
* Bucket validation.
* group_by validation.

## Integration Tests

Examples:

* PostgreSQL repository operations.
* Bulk ingestion.
* Service filtering.
* Level filtering.
* Time filtering.
* Attribute filtering.
* Message filtering.
* Cursor pagination.
* Aggregation.
* Retention.

## Contract Tests

Validate exact required behavior:

* `GET /health`
* `POST /logs`
* `GET /logs`
* `GET /logs/aggregate`

Verify:

* HTTP status codes.
* Required response structures.
* Invalid parameter behavior.
* Partial batch acceptance.
* malformed JSON handling.
* cursor errors.

## Load Tests

Load testing should include:

* Approximately 1,000,000 stored logs.
* Ingestion target of at least 15,000 logs/sec.
* Aggregation requests while ingestion is running.
* Concurrent queries during ingestion.
* Query latency percentiles.
* CPU and memory usage.

---

# 35. CI Strategy

The CI pipeline should perform meaningful validation.

Conceptually:

```text
Push / Pull Request
        |
        v
Install Dependencies
        |
        v
Type Check / Build
        |
        v
Unit Tests
        |
        v
Integration / Contract Tests
        |
        v
Docker Build
        |
        v
Smoke Test
```

The default unauthenticated configuration must be tested.

If optional authentication is implemented later, the required authenticated configuration will also be tested.

---

# 36. Performance Strategy

Performance decisions should be measurement-driven.

The optimization process will be:

```text
Correct Implementation
        |
        v
Contract Tests
        |
        v
Generate Realistic Dataset
        |
        v
Load Test
        |
        v
EXPLAIN ANALYZE
        |
        v
Identify Bottleneck
        |
        v
Apply Targeted Optimization
        |
        v
Measure Again
```

Possible optimizations include:

* Different bulk insert sizes.
* PostgreSQL COPY.
* Connection pool tuning.
* Composite indexes.
* JSONB indexes.
* Trigram message search indexes.
* Query changes.
* Retention batch tuning.
* Partitioning.
* Pre-aggregated rollup tables.

None will be introduced without a demonstrated need unless required for correctness.

---

# 37. Performance Targets

The design should be evaluated against the required targets:

* At least 15,000 logs per second sustained ingestion.
* Approximately 1,000,000 stored logs.
* No application crashes during sustained ingestion.
* No silently dropped acknowledged logs.
* Primary aggregation query under 1 second at p95.
* Query performance maintained during ingestion.
* Newly ingested data queryable within 20 seconds.
* Approximately one aggregation request per second during ingestion testing.

---

# 38. Performance Documentation

The final README should document actual measured results, including:

* Test environment.
* Dataset size.
* Batch size.
* Ingestion rate.
* Query rate.
* Query latency percentiles.
* Resource usage.
* Bottlenecks discovered.
* Optimizations applied.

Performance assumptions should not be presented as measured results.

---

# 39. Current Open Performance Questions

The following decisions intentionally remain open until implementation and benchmarking:

* Optimal ingestion batch size.
* Multi-row INSERT vs PostgreSQL COPY.
* Exact connection pool size.
* Final index strategy.
* JSONB indexing strategy.
* Message trigram indexing.
* Exact retention deletion batch size.
* Retention worker interval.
* Whether partitioning is ever required.
* Whether rollup tables are required.

These are tuning and optimization decisions rather than unresolved core architecture decisions.

---

# 40. Final Initial Architecture

The initial system should therefore remain:

```text
                    Client
                      |
                      v
               HTTP Controller
                      |
                      v
                    Service
                 /           \
                v             v
           Validator     Query Builder
                \             /
                 \           /
                      |
                      v
                  Repository
                      |
                      v
              PostgreSQL Pool
                      |
                      v
                 PostgreSQL
                      |
             Single Logs Table
              /              \
             v                v
      Fixed Columns      JSONB Attributes


Application Process
       |
       ├── HTTP Server
       |
       └── Retention Worker
```

Initial technical strategy:

```text
PostgreSQL
TypeScript
Single logs table
Fixed columns + JSONB
BIGINT identity
Bulk INSERT
Parameterized dynamic SQL
Keyset pagination
(timestamp, id) ordering
Real-time aggregation
Time-based retention
Small retention deletes
Controlled connection pool
Minimal indexes
No cache
No partitioning initially
No message queue
No additional infrastructure
Docker Compose
Automated migrations
Contract tests
Load testing
CI
```

The core principle is:

```text
Build the simplest correct architecture
            ↓
Measure it under the real workload
            ↓
Find the actual bottleneck
            ↓
Optimize only what the measurements justify
```