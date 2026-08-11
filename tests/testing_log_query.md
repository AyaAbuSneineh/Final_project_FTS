# GET /logs Testing

## Endpoint
`GET /logs`

Functional and reliability tests for log querying.

## Test Results

| Test | Result |
|---|---|
| Query without filters | PASS |
| `service` exact filter | PASS |
| `level` exact filter | PASS |
| Multiple filters together | PASS |
| `limit` and pagination behavior | PASS |
| `q` case-insensitive substring search | PASS |
| `attr.<key>` equality filter | PASS |
| Multiple attribute filters | PASS |
| `since` inclusive | PASS |
| `until` exclusive | PASS |
| `since` + `until` | PASS |
| Cursor pagination | PASS |
| Same timestamp ordered by `id DESC` | PASS |
| Empty result returns `logs: []` | PASS |
| Invalid level returns `400` | PASS |
| Invalid limit returns `400` | PASS |
| Invalid timestamp returns `400` | PASS |
| `until` earlier than `since` returns `400` | PASS |
| Invalid cursor returns `400` | PASS |
| Unknown query parameter returns `400` | PASS |
| SQL injection-like input treated as data | PASS |

## Cursor Pagination

A request with `limit=3` returned three logs and a `next_cursor`.

Using that cursor returned the next three logs without repeating the last row from the previous page.

Rows sharing the same timestamp were correctly ordered by:

```text
timestamp DESC, id DESC
```

## Concurrent POST + GET

The service was tested with ingestion and querying at the same time:

```text
50 POST requests × 100 logs
100 GET requests
Concurrency: 10 requests per group
```

Results:

```text
POST: 50 × HTTP 200
GET:  100 × HTTP 200
```

A query after the test successfully returned the latest `live-mix-test` logs with a valid `next_cursor`.

## Conclusion

`GET /logs` passed dynamic filtering, validation, cursor pagination, safe parameterized querying, and concurrent read/write checks.

Final performance benchmarking will be done separately under the required container resource limits.
