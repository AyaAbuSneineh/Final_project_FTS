# GET /logs/aggregate Testing

## Endpoint
`GET /logs/aggregate`

Functional tests for time-bucket aggregation.

## Test Results

| Test | Result |
|---|---|
| `5m` bucket | PASS |
| `1m` bucket | PASS |
| `1h` bucket | PASS |
| `1d` bucket | PASS |
| No `group_by` → `group: null` | PASS |
| `group_by=service` | PASS |
| `group_by=level` | PASS |
| `service` filter | PASS |
| `level` filter | PASS |
| `attr.<key>` filter | PASS |
| `q` case-insensitive substring filter | PASS |
| Multiple filters combined | PASS |
| Buckets ordered ascending | PASS |
| Empty buckets omitted | PASS |
| Missing `since` | `400` |
| Missing `until` | `400` |
| Invalid bucket | `400` |
| Invalid `group_by` | `400` |
| `until` earlier than `since` | `400` |

## Example Results

### 5-minute buckets without grouping

```text
00:10 -> 2000
00:20 -> 3801
00:25 -> 1
```

### Grouped by service

```text
00:10 bulk-test        -> 2000
00:20 concurrent-bulk  -> 2000
00:20 mixed-bulk       -> 1800
00:20 validation-test  -> 1
00:25 time-test        -> 1
```

### Combined Filters

Using service, level, attribute, message search, and `group_by=service` together returned:

```text
00:20 concurrent-bulk -> 20
```

## Conclusion

`GET /logs/aggregate` passed bucket aggregation, grouping, filtering, ordering, and validation tests.

Final performance benchmarking will be documented separately under the required container resource limits.
