## Cursor-based Pagination

### Decision

Use cursor-based pagination instead of offset pagination.

### Ordering

Logs are ordered by:

timestamp DESC, id DESC

### Cursor Content

The cursor contains:
- last returned timestamp
- last returned id

### Reason

- Avoid expensive OFFSET scans.
- Provide stable pagination.
- Maintain performance with millions of log records.
- Ensure deterministic ordering when timestamps are identical.