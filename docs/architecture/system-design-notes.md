# System Design Notes

# Design Principles

Current design is based on the following principles:

- Minimize database round trips
- Keep write operations efficient
- Build only what is required
- Separate responsibilities between layers
- Optimize for the expected workload
- Make future scaling possible

---

# Current Architecture

# Database

## Selected Database

Decision:

- PostgreSQL

Reasoning:

- Required by project specification
- Strong indexing support
- ACID transactions
- Excellent querying capabilities
- Native JSONB support
- Good performance for mixed read/write workloads

---

# Log Storage Strategy

Current decision:

Hybrid storage.

Fixed fields will be stored as regular columns.

Example:

- id
- timestamp
- level
- service
- message

Dynamic attributes will be stored inside a JSONB column.

Reasoning:

Benefits of fixed columns:

- Frequently queried
- Stable schema
- Easier indexing
- Faster filtering

Benefits of JSONB:

- Flexible schema
- No schema migration for new attributes
- Supports indexing
- Suitable for arbitrary key/value pairs

This approach combines normalization with flexibility.

---

# Validation Strategy

Validation happens before inserting data into the database.

Each batch is processed as follows:

1. Validate every log independently.
2. Separate valid and invalid entries.
3. Insert only valid logs.
4. Return rejected entries with index and reason.

Reasoning:

- Avoid unnecessary database work
- Reduce failed insert operations
- Match project requirements

---

# Insert Strategy

Current direction:

Use Bulk Insert instead of inserting logs individually.

Reasoning:

- Fewer database round trips
- Better throughput
- Lower overhead
- Better scalability

---

# Query Strategy

The project supports optional filters.

Examples:

- service
- level
- since
- until
- message search
- attributes

Because every combination is possible, queries will be built dynamically.

Current decision:

Use a dynamic query builder.

Never concatenate raw SQL strings.

Parameterized queries will always be used.

Reasoning:

- Prevent SQL Injection
- Easier maintenance
- Supports arbitrary filter combinations

---

# Layered Architecture

Current direction:

Controller

↓

Service

↓

Repository

↓

Database

Responsibilities:

Controller

- HTTP
- Request parsing
- Response formatting

Service

- Business logic
- Validation
- Workflow

Repository

- Database access
- Query generation

---

# Caching

Current decision:

No caching in the initial implementation.

Reasoning:

- High write workload
- Frequently changing data
- Cache invalidation complexity

Caching may be introduced later after workload analysis.

---

# Primary Key

### Decision

Use BIGINT GENERATED ALWAYS AS IDENTITY as the primary key.

### Reason

- Faster inserts than UUID.
- Smaller indexes.
- Better B-tree index performance.
- Better cache locality.
- Useful for deterministic ordering together with timestamp.
- Overflow is practically impossible for this project when using BIGINT.

# Cursor-based Pagination

### Decision

Use cursor-based pagination instead of OFFSET pagination.

### Reason

- OFFSET becomes slower as the dataset grows.
- Better scalability with millions of log records.
- Stable pagination even while new logs are being inserted.
- Cursor will be based on (timestamp, id).

## ADR-006: Retention Strategy

### Decision

Use weekly time-based partitioning combined with a hybrid retention strategy. Logs will be stored in weekly partitions, and a background retention worker will periodically monitor storage size, log count, and data age. When retention limits are exceeded, the system will remove the oldest data first until the configured limits are restored.

### Reason

A time-only retention policy is not enough because log volume can vary significantly. Weekly partitions provide a balance between performance and manageability, allowing efficient cleanup by removing old partitions instead of performing expensive large DELETE operations. The hybrid approach prevents uncontrolled database growth while maintaining ingestion performance.

# Database Connection Management

### Decision

Use a PostgreSQL connection pool with a controlled number of connections combined with bulk inserts for log ingestion.

### Reason

Opening a new database connection for every request is expensive and can overload PostgreSQL under high ingestion rates. A limited connection pool provides controlled concurrency while bulk inserts reduce database round trips and improve throughput. The pool size will be tuned through load testing based on system resource limits.

# Application Layer Separation

### Decision

Use a layered architecture where HTTP handling, validation, business logic, and database access are separated.

### Reason

Separating responsibilities improves maintainability, testing, and scalability. Validation is performed before database insertion to allow partial batch acceptance, while database constraints provide an additional safety layer.

## Aggregation Design

### Decision

Use real-time aggregation queries directly on the logs table for the current system design. The aggregation endpoint will calculate log counts dynamically based on the requested time range, bucket size, and grouping dimensions.

### Reason

The expected workload is around one million log records with a limited aggregation query rate, so real-time aggregation provides a simpler design while maintaining up-to-date results. Additional complexity from maintaining pre-aggregated tables is not required at this scale. If future load testing shows that aggregation performance is insufficient, rollup tables can be introduced as an optimization.


# Reliability

The service should never acknowledge logs before they are safely persisted.

Current focus:

Balance:

- Throughput
- Reliability

Trade-offs will be evaluated during implementation.

---

# Health Check

The application should report healthy only after:

- Database connection established
- Migrations completed
- Service ready to accept requests

Returning HTTP 200 only means the system is actually ready.

---

# Performance Mindset

Current optimization goals:

- Reduce number of database queries
- Use bulk operations whenever possible
- Keep ingestion pipeline lightweight
- Avoid unnecessary joins
- Choose indexes carefully
- Optimize for expected query patterns

---

# Open Questions

The following decisions are still under investigation:

- Optimal batch size
- Transaction strategy
- Index strategy
- JSONB indexing approach
- Cursor implementation
- Connection pool sizing
- Retention implementation
- Database partitioning
- COPY vs Bulk Insert
- Worker architecture
- Docker architecture