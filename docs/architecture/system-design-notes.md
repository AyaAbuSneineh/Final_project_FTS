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