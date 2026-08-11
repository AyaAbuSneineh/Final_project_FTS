# POST /logs Testing

## Test Environment
- Application: local with `npm run dev`
- PostgreSQL: Docker
- Endpoint: `POST /logs`
- These are functional/reliability tests, not the final performance benchmark.

## Test Results

| Test | Expected | Status |
|---|---|---|
| Valid single log | `200`, accepted = 1 | PASS |
| Partial acceptance | Valid stored, invalid rejected, `200` | PASS |
| All invalid | `400`, accepted = 0 | PASS |
| Missing `logs` | `400` | PASS |
| `logs` not array | `400` | PASS |
| Empty batch | `400` | PASS |
| Malformed JSON | `400` | PASS |
| Invalid level | Rejected | PASS |
| Empty service/message | Rejected | PASS |
| Invalid/non-ISO timestamp | Rejected | PASS |
| Timestamp > 5 min future | Rejected | PASS |
| Timestamp within 5 min future | Accepted | PASS |
| Valid flat attributes | Accepted | PASS |
| Nested/array attributes | Rejected | PASS |
| `attributes: null` | Rejected | PASS |
| Missing attributes | Stored as `{}` | PASS |
| Body above configured limit | `413` | PASS |

## Bulk Ingestion

### 1000 Valid Logs
```text
accepted: 1000
rejected: 0
HTTP: 200
```

Local sanity-test times:
```text
0.481061 s
0.104555 s
```

### Mixed Batch
1000 logs: 900 valid, 100 invalid.

```text
accepted: 900
rejected: 100
HTTP: 200
```

Only valid logs were persisted.

### Concurrent Requests
20 concurrent requests, 100 logs each.

```text
20 requests -> HTTP 200
2000 logs persisted
```

## Database Verification

```text
bulk-test        2000
checkout            4
concurrent-bulk  2000
mixed-bulk       1800
payment             1
time-test            1
validation-test      1
```

Total rows:

```text
5807
```

Level totals:

```text
info   5806
error     1
```

## Conclusion
`POST /logs` passed validation, partial acceptance, bulk insert, error handling, concurrency, and database integrity checks.

Final performance testing under the required CPU and memory limits will be documented separately.
