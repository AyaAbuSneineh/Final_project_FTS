# System Design Notes

## Design Principles

Current design is based on the following principles:

- Minimize database round trips.
- Keep write operations efficient.
- Build only what is required.
- Separate responsibilities between layers.
- Optimize for the expected workload.
- Make future scaling possible.
- Prefer simple solutions before adding unnecessary complexity.
- Maintain reliability while improving throughput.

---

# Current Architecture

## High-Level Architecture

The system consists of:

```

Client
|
|
HTTP API
|
|
Application Service
|
|
PostgreSQL

````

The application is responsible for:

- Receiving logs.
- Validating requests.
- Processing queries.
- Managing retention tasks.

PostgreSQL remains the source of truth for all stored data.

---

# Database

## Selected Database

### Decision

Use PostgreSQL.

### Reasoning

- Required by project specification.
- Strong indexing support.
- ACID transactions.
- Excellent querying capabilities.
- Native JSONB support.
- Good performance for mixed read/write workloads.
- Supports partitioning and query optimization.

---

# Log Storage Strategy

## Decision

Use a hybrid storage model.

Fixed fields will be stored as regular columns:

- id
- timestamp
- level
- service
- message

Dynamic attributes will be stored inside a JSONB column.

Example:

```json
{
  "user_id": "42",
  "region": "eu-west",
  "retry": 3
}
````

## Reasoning

### Fixed Columns Benefits

* Frequently queried fields.
* Stable schema.
* Easier indexing.
* Faster filtering.
* Better query planning.

### JSONB Benefits

* Flexible schema.
* Supports arbitrary key/value attributes.
* Avoids frequent schema migrations.
* Supports indexing when needed.

This approach balances structured querying with schema flexibility.

---

# Database Schema (Initial Design)

Initial expected schema:

```sql
CREATE TABLE logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL,
    level TEXT NOT NULL,
    service TEXT NOT NULL,
    message TEXT NOT NULL,
    attributes JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

The final schema and indexes will be adjusted after query analysis and benchmarking.

---

# Primary Key Design

## Decision

Use:

```
BIGINT GENERATED ALWAYS AS IDENTITY
```

as the primary key.

## Reasoning

* Faster inserts compared with UUID.
* Smaller indexes.
* Better B-tree index performance.
* Better cache locality.
* Useful for deterministic ordering.
* Suitable for cursor pagination.

BIGINT overflow is practically impossible for the expected workload.

---

# Validation Strategy

Validation happens before inserting data into the database.

Processing flow:

```
Request
   |
Validation
   |
Separate valid/invalid logs
   |
Bulk Insert valid logs
   |
Return rejected entries
```

Steps:

1. Validate every log entry.
2. Collect valid entries.
3. Collect invalid entries with reasons.
4. Insert only valid logs.
5. Return rejection details.

## Reasoning

* Avoid unnecessary database operations.
* Prevent invalid data storage.
* Support partial batch acceptance.
* Match project requirements.

Database constraints remain an additional safety layer.

---

# Insert Strategy

## Decision

Use Bulk Insert.

## Reasoning

* Reduce database round trips.
* Increase ingestion throughput.
* Lower transaction overhead.
* Better scalability.

Single-row inserts are avoided because the system handles high ingestion rates.

---

# Transaction Strategy

## Decision

Use one database transaction per accepted batch.

Example:

```sql
BEGIN;

INSERT INTO logs (...);

COMMIT;
```

## Reasoning

* Ensures durability.
* Prevents partial database writes.
* Reduces transaction overhead.
* Matches bulk insertion strategy.

The service will not return success before logs are safely persisted.

---

# Query Strategy

The system supports dynamic combinations of filters:

Examples:

* service
* level
* timestamp range
* message search
* attributes

## Decision

Use a dynamic query builder.

Rules:

* Never concatenate raw SQL strings.
* Always use parameterized queries.

## Reasoning

* Prevent SQL injection.
* Support flexible filtering.
* Maintain clean query generation.

---

# Index Strategy

Currently under investigation.

Indexes will be designed based on real query patterns.

Main goals:

* Fast timestamp filtering.
* Efficient sorting.
* Support common query combinations.
* Avoid excessive indexes that slow down ingestion.

Possible indexes:

* Timestamp index.
* Composite indexes for common filters.
* JSONB indexes for frequently queried attributes.

Final index selection will be based on:

* EXPLAIN ANALYZE.
* Load testing.
* Query latency measurements.

---

# Cursor-Based Pagination

## Decision

Use cursor-based pagination instead of OFFSET pagination.

Cursor will be based on:

```
(timestamp, id)
```

Sorting:

```
timestamp DESC,
id DESC
```

## Reasoning

* OFFSET becomes slower with large datasets.
* Better performance with millions of records.
* Stable ordering.
* Handles new inserts better.

---

# Database Connection Management

## Decision

Use PostgreSQL connection pool with controlled connections.

Combined with:

* Bulk inserts.
* Limited concurrency.

## Reasoning

Opening a connection for every request is expensive.

Connection pooling provides:

* Controlled resource usage.
* Better throughput.
* Protection against database overload.

Pool size will be tuned using load testing.

---

# Aggregation Design

## Decision

Use real-time aggregation directly from the logs table.

The aggregation endpoint calculates:

* Time buckets.
* Counts.
* Grouping by service or level.

Example:

```
14:00 → 120 logs
14:05 → 200 logs
```

## Reasoning

Expected workload:

* Around one million logs.
* Limited aggregation requests.

Real-time aggregation provides:

* Simpler architecture.
* Always fresh results.
* No extra storage overhead.

If performance becomes insufficient, pre-aggregated rollup tables can be introduced.

---

# Retention Strategy

## Decision

Use weekly time-based partitioning combined with hybrid retention.

Retention worker monitors:

* Data age.
* Database size.
* Number of stored logs.

When limits are exceeded:

* Remove oldest data first.
* Drop old partitions when possible.

## Reasoning

Time-only retention is insufficient because log volume changes over time.

Partitioning provides:

* Faster cleanup.
* Less table bloat.
* Better ingestion performance.

---

# Caching

## Decision

No caching in the initial implementation.

## Reasoning

* Logs are frequently changing.
* High write workload.
* Cache invalidation complexity.

Caching may be added later after workload analysis.

Possible future uses:

* Aggregation results.
* Frequently repeated queries.

---

# Layered Architecture

Structure:

```
Controller

↓

Service

↓

Repository

↓

Database
```

## Controller

Responsible for:

* HTTP handling.
* Request parsing.
* Response formatting.

Does not contain:

* Business logic.
* Database queries.

---

## Service

Responsible for:

* Business rules.
* Validation workflow.
* Processing logic.

---

## Repository

Responsible for:

* Database operations.
* SQL generation.
* Query execution.

---

# Reliability

The service should never acknowledge logs before they are safely stored.

Main goal:

Balance:

* Throughput.
* Reliability.
* Resource usage.

---

# Health Check

The service reports healthy only after:

* Database connection established.
* Migrations completed.
* Application ready to receive requests.

HTTP 200 means the service is ready.

---

# Docker Architecture

Planned deployment:

```
docker-compose

Application Container
        |
        |
PostgreSQL Container
```

Requirements:

* Service exposed on port 8080.
* Automatic migrations.
* Environment-based configuration.
* Persistent database volume.

---

# CI Pipeline

Planned pipeline:

On every push:

1. Install dependencies.
2. Build application.
3. Run tests.
4. Start Docker environment.
5. Run smoke tests.

---

# Performance Strategy

Optimization goals:

* Reduce database round trips.
* Use bulk operations.
* Keep ingestion lightweight.
* Avoid unnecessary joins.
* Use indexes carefully.
* Measure before optimizing.

Performance evaluation:

* Ingestion throughput.
* Query latency.
* CPU usage.
* Memory usage.
* Database performance.

---

# Open Questions

The following decisions are still under investigation:

* Final database schema.
* Final index strategy.
* JSONB indexing approach.
* Batch size.
* Connection pool size.
* COPY vs Bulk Insert.
* Partition implementation.
* Retention worker design.
* Docker optimization.
* Load testing methodology.
* Performance bottlenecks.