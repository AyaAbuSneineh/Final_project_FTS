# Testing Notes

## Health Check

Endpoint:

```http
GET /health
```

Expected behavior:

* Returns `200 OK` when PostgreSQL is available.
* Returns `503 Service Unavailable` when PostgreSQL is unavailable.
* The application must remain running if PostgreSQL goes down.
* The health endpoint should recover automatically when PostgreSQL becomes available again.

---

## 1. Normal Health Check

Command:

```bash
curl -i http://localhost:8080/health
```

Result:

```http
HTTP/1.1 200 OK
```

Response:

```json
{"status":"ok"}
```

Status: PASS

---

## 2. Concurrent Health Requests - 20 Workers

Command:

```bash
seq 1 1000 | xargs -P20 -I{} curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/health | sort | uniq -c
```

Result:

```text
1000 200
```

Meaning:

* 1000 requests were sent.
* Up to 20 requests were executed concurrently.
* All 1000 requests returned HTTP 200.

Status: PASS

---

## 3. Concurrent Health Requests - 50 Workers

Command:

```bash
seq 1 1000 | xargs -P50 -I{} curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/health | sort | uniq -c
```

Result:

```text
1000 200
```

Meaning:

* 1000 requests were sent.
* Up to 50 requests were executed concurrently.
* All requests returned HTTP 200.

Status: PASS

---

## 4. Database Failure Test

PostgreSQL was stopped using:

```bash
docker compose stop postgres
```

Then 200 health requests were sent:

```bash
seq 1 200 | xargs -P20 -I{} curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/health | sort | uniq -c
```

Result:

```text
200 503
```

Meaning:

* PostgreSQL was unavailable.
* The Express application remained running.
* All health requests correctly returned HTTP 503.

Status: PASS

During PostgreSQL shutdown, the pool reported:

```text
terminating connection due to administrator command
PostgreSQL error code: 57P01
```

The pool error was handled and did not terminate the application.

---

## 5. Database Recovery Test

PostgreSQL was started again:

```bash
docker compose start postgres
```

Then:

```bash
seq 1 500 | xargs -P20 -I{} curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/health | sort | uniq -c
```

Result:

```text
500 200
```

Meaning:

* PostgreSQL became available again.
* The connection pool recovered automatically.
* All 500 requests returned HTTP 200.

Status: PASS

---

## Health Check Test Summary

| Scenario             | Requests | Concurrency | Result     |
| -------------------- | -------: | ----------: | ---------- |
| Database available   |     1000 |          20 | 1000 × 200 |
| Database available   |     1000 |          50 | 1000 × 200 |
| Database unavailable |      200 |          20 | 200 × 503  |
| Database recovered   |      500 |          20 | 500 × 200  |

All health check tests passed.
