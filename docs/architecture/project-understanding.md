# System Overview

This project is designed to handle a **large volume of incoming requests**, store them efficiently, and provide **fast querying and retrieval** of the stored data.

The system is primarily **write-heavy**, meaning that write operations occur much more frequently than read operations. Therefore, the architecture is optimized for high-throughput inserts while still supporting efficient search and aggregation.

## Workload Characteristics

### Write-Heavy Operations

The most common operation is storing logs received from applications.

```text
Applications
      │
      ▼
 POST /logs
      │
      ▼
 Store
```

### Read Operations

The system also supports querying stored logs and retrieving aggregated information.

```text
GET /logs
GET /aggregate
```

---

# Request Flow

## Log Ingestion (Write Path)

When a client submits logs, the request passes through several layers before being stored in PostgreSQL.

```text
Application
      │
      ▼
POST /logs
      │
      ▼
Controller
      │
      ▼
Validation
      │
      ▼
Service
      │
      ▼
Repository
      │
      ▼
Bulk Insert
      │
      ▼
PostgreSQL
```

### Description

* **Controller** receives the HTTP request.
* **Validation** verifies the request body and input data.
* **Service** contains the business logic.
* **Repository** handles database operations.
* **Bulk Insert** efficiently stores multiple log records in PostgreSQL.
* **PostgreSQL** persists the data.

---

## Log Search (Read Path)

When searching for logs, the system validates the query parameters and dynamically builds the SQL query before fetching data from PostgreSQL.

```text
GET /logs
      │
      ▼
Controller
      │
      ▼
Validate Query
      │
      ▼
Service
      │
      ▼
Repository
      │
      ▼
Dynamic SQL
      │
      ▼
PostgreSQL
      │
      ▼
Response
```

### Description

* The **Controller** receives the search request.
* **Query validation** ensures the search parameters are valid.
* The **Service** processes the request.
* The **Repository** generates a **dynamic SQL query** based on the provided filters.
* PostgreSQL executes the query and returns the matching records.
* The API sends the response back to the client.
