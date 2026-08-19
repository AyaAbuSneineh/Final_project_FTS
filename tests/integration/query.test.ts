import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { app } from "../../src/app.js";
import { resetDb } from "./setup.js";

const BASE_TIME = new Date("2026-07-20T14:00:00.000Z").getTime();

function at(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1000).toISOString();
}

async function seed(logs: Array<Record<string, unknown>>): Promise<void> {
  const response = await request(app).post("/logs").send({ logs });
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  await resetDb();
});

describe("GET /logs", () => {
  it("returns an empty array when there is no data", async () => {
    const response = await request(app).get("/logs");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ logs: [], next_cursor: null });
  });

  it("filters by exact service and level", async () => {
    await seed([
      { timestamp: at(0), level: "error", service: "checkout", message: "a" },
      { timestamp: at(1), level: "info", service: "checkout", message: "b" },
      { timestamp: at(2), level: "error", service: "auth", message: "c" },
    ]);

    const response = await request(app).get("/logs").query({ service: "checkout", level: "error" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0].message).toBe("a");
  });

  it("filters by since (inclusive) and until (exclusive)", async () => {
    await seed([
      { timestamp: at(0), level: "info", service: "svc", message: "at-start" },
      { timestamp: at(60), level: "info", service: "svc", message: "middle" },
      { timestamp: at(120), level: "info", service: "svc", message: "at-end" },
    ]);

    const response = await request(app)
      .get("/logs")
      .query({ since: at(0), until: at(120), service: "svc" });

    expect(response.status).toBe(200);
    const messages = response.body.logs.map((log: { message: string }) => log.message);
    expect(messages).toContain("at-start");
    expect(messages).toContain("middle");
    expect(messages).not.toContain("at-end");
  });

  it("performs a case-insensitive substring match on message", async () => {
    await seed([
      { timestamp: at(0), level: "error", service: "svc", message: "Payment DECLINED for user" },
      { timestamp: at(1), level: "error", service: "svc", message: "payment approved" },
    ]);

    const response = await request(app).get("/logs").query({ q: "declined", service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0].message).toMatch(/declined/i);
  });

  it("treats a percent sign in q as a literal character, not a wildcard", async () => {
    await seed([
      { timestamp: at(0), level: "info", service: "svc", message: "disk at 100% capacity" },
      { timestamp: at(1), level: "info", service: "svc", message: "disk at 50 capacity" },
    ]);

    const response = await request(app).get("/logs").query({ q: "100%", service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
  });

  it("filters by attr.<key> equality", async () => {
    await seed([
      { timestamp: at(0), level: "info", service: "svc", message: "a", attributes: { user_id: "42" } },
      { timestamp: at(1), level: "info", service: "svc", message: "b", attributes: { user_id: "43" } },
    ]);

    const response = await request(app).get("/logs").query({ "attr.user_id": "42", service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
    expect(response.body.logs[0].message).toBe("a");
  });

  it("matches numeric and boolean attribute values as their string form", async () => {
    await seed([
      {
        timestamp: at(0),
        level: "info",
        service: "svc",
        message: "numeric-attr",
        attributes: { retries: 3, active: true },
      },
    ]);

    const response = await request(app)
      .get("/logs")
      .query({ "attr.retries": "3", "attr.active": "true", service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toHaveLength(1);
  });

  it("orders results by timestamp descending, tie-broken deterministically by id", async () => {
    const sameTimestamp = at(0);
    await seed([
      { timestamp: sameTimestamp, level: "info", service: "svc", message: "first-inserted" },
      { timestamp: sameTimestamp, level: "info", service: "svc", message: "second-inserted" },
    ]);

    const response = await request(app).get("/logs").query({ service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs.map((l: { message: string }) => l.message)).toEqual([
      "second-inserted",
      "first-inserted",
    ]);
  });

  it("paginates via cursor without repeating or skipping rows", async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      timestamp: at(i),
      level: "info" as const,
      service: "paginate-me",
      message: `entry-${i}`,
    }));
    await seed(entries);

    const page1 = await request(app).get("/logs").query({ service: "paginate-me", limit: 2 });
    expect(page1.status).toBe(200);
    expect(page1.body.logs).toHaveLength(2);
    expect(page1.body.next_cursor).not.toBeNull();

    const page2 = await request(app)
      .get("/logs")
      .query({ service: "paginate-me", limit: 2, cursor: page1.body.next_cursor });
    expect(page2.status).toBe(200);
    expect(page2.body.logs).toHaveLength(2);

    const page3 = await request(app)
      .get("/logs")
      .query({ service: "paginate-me", limit: 2, cursor: page2.body.next_cursor });
    expect(page3.status).toBe(200);
    expect(page3.body.logs).toHaveLength(1);
    expect(page3.body.next_cursor).toBeNull();

    const allMessages = [...page1.body.logs, ...page2.body.logs, ...page3.body.logs].map(
      (l: { message: string }) => l.message,
    );
    expect(new Set(allMessages).size).toBe(5);
  });

  it("rejects an invalid level", async () => {
    const response = await request(app).get("/logs").query({ level: "critical" });
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it("rejects an invalid limit", async () => {
    const response = await request(app).get("/logs").query({ limit: "abc" });
    expect(response.status).toBe(400);
  });

  it("rejects a limit outside the supported range", async () => {
    const response = await request(app).get("/logs").query({ limit: "5000" });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid timestamp", async () => {
    const response = await request(app).get("/logs").query({ since: "not-a-timestamp" });
    expect(response.status).toBe(400);
  });

  it("rejects until earlier than since", async () => {
    const response = await request(app)
      .get("/logs")
      .query({ since: at(60), until: at(0) });
    expect(response.status).toBe(400);
  });

  it("rejects a malformed cursor", async () => {
    const response = await request(app).get("/logs").query({ cursor: "!!!not-valid!!!" });
    expect(response.status).toBe(400);
  });

  it("treats a SQL-injection-shaped q value as plain data", async () => {
    await seed([{ timestamp: at(0), level: "info", service: "svc", message: "normal message" }]);

    const response = await request(app)
      .get("/logs")
      .query({ q: "'; DROP TABLE logs; --", service: "svc" });

    expect(response.status).toBe(200);
    expect(response.body.logs).toEqual([]);

    const followUp = await request(app).get("/logs").query({ service: "svc" });
    expect(followUp.status).toBe(200);
    expect(followUp.body.logs).toHaveLength(1);
  });
});
