# Choosing the Primary Key

Since the system handles millions of logs and is mainly **write-heavy**, choosing the right primary key type is important for performance and scalability.

Two options were considered:

## 1. BIGINT (Incremental ID)

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

**Advantages:**

* Faster for insert and query operations.
* Smaller index size (8 bytes).
* Works well with cursor-based pagination.
* Using `BIGINT` makes reaching the maximum limit practically impossible even with very large log volumes.

## 2. UUID

```sql
id UUID PRIMARY KEY
```

**Advantages:**

* Suitable for distributed systems where multiple services generate data independently.

**Disadvantages:**

* Does not maintain a natural ordering.
* Larger index size, which can affect performance.

## Final Decision

The system will use:

```sql
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

because it provides better performance for **high-throughput inserts and queries**, making it more suitable for this project.

Logs will be ordered using:

```sql
ORDER BY timestamp DESC, id DESC
```

This ensures that logs are sorted by creation time, while the `id` is used as a tie-breaker when multiple logs have the same timestamp.
