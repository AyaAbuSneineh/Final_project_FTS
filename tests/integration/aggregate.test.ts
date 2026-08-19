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

describe("GET /logs/aggregate", () => {
  it("buckets counts by the requested bucket size, ascending", async () => {
    await seed([
      { timestamp: at(0), level: "info", service: "checkout", message: "a" },
      { timestamp: at(30), level: "info", service: "checkout", message: "b" },
      { timestamp: at(90), level: "info", service: "checkout", message: "c" },
    ]);

    const response = await request(app).get("/logs/aggregate").query({
      since: at(0),
      until: at(120),
      bucket: "1m",
      service: "checkout",
    });

    expect(response.status).toBe(200);
    expect(response.body.buckets.length).toBeGreaterThanOrEqual(2);
    expect(response.body.buckets[0].group).toBeNull();

    const starts = response.body.buckets.map((b: { start: string }) => Date.parse(b.start));
    const sorted = [...starts].sort((a, b) => a - b);
    expect(starts).toEqual(sorted);
  });

  it("groups by service", async () => {
    await seed([
      { timestamp: at(0), level: "info", service: "checkout", message: "a" },
      { timestamp: at(0), level: "info", service: "checkout", message: "b" },
      { timestamp: at(0), level: "info", service: "auth", message: "c" },
    ]);

    const response = await request(app).get("/logs/aggregate").query({
      since: at(0),
      until: at(60),
      bucket: "1m",
      group_by: "service",
    });

    expect(response.status).toBe(200);
    const byGroup = Object.fromEntries(
      response.body.buckets.map((b: { group: string; count: number }) => [b.group, b.count]),
    );
    expect(byGroup.checkout).toBe(2);
    expect(byGroup.auth).toBe(1);
  });

  it("groups by level", async () => {
    await seed([
      { timestamp: at(0), level: "error", service: "svc", message: "a" },
      { timestamp: at(0), level: "warn", service: "svc", message: "b" },
    ]);

    const response = await request(app).get("/logs/aggregate").query({
      since: at(0),
      until: at(60),
      bucket: "1m",
      group_by: "level",
      service: "svc",
    });

    expect(response.status).toBe(200);
    const byGroup = Object.fromEntries(
      response.body.buckets.map((b: { group: string; count: number }) => [b.group, b.count]),
    );
    expect(byGroup.error).toBe(1);
    expect(byGroup.warn).toBe(1);
  });

  it("combines service, level, attr, and q filters", async () => {
    await seed([
      {
        timestamp: at(0),
        level: "error",
        service: "checkout",
        message: "payment declined",
        attributes: { region: "eu-west" },
      },
      {
        timestamp: at(0),
        level: "error",
        service: "checkout",
        message: "payment declined",
        attributes: { region: "us-east" },
      },
      { timestamp: at(0), level: "info", service: "checkout", message: "payment declined" },
    ]);

    const response = await request(app).get("/logs/aggregate").query({
      since: at(0),
      until: at(60),
      bucket: "1m",
      service: "checkout",
      level: "error",
      q: "declined",
      "attr.region": "eu-west",
    });

    expect(response.status).toBe(200);
    const total = response.body.buckets.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
    expect(total).toBe(1);
  });

  it("omits empty buckets", async () => {
    await seed([{ timestamp: at(0), level: "info", service: "svc", message: "a" }]);

    const response = await request(app).get("/logs/aggregate").query({
      since: at(0),
      until: at(3600),
      bucket: "1m",
      service: "svc",
    });

    expect(response.status).toBe(200);
    expect(response.body.buckets).toHaveLength(1);
  });

  it("requires since", async () => {
    const response = await request(app).get("/logs/aggregate").query({ until: at(60), bucket: "1m" });
    expect(response.status).toBe(400);
  });

  it("requires until", async () => {
    const response = await request(app).get("/logs/aggregate").query({ since: at(0), bucket: "1m" });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid bucket", async () => {
    const response = await request(app)
      .get("/logs/aggregate")
      .query({ since: at(0), until: at(60), bucket: "3m" });
    expect(response.status).toBe(400);
  });

  it("rejects an invalid group_by", async () => {
    const response = await request(app)
      .get("/logs/aggregate")
      .query({ since: at(0), until: at(60), bucket: "1m", group_by: "region" });
    expect(response.status).toBe(400);
  });

  it("rejects until earlier than since", async () => {
    const response = await request(app)
      .get("/logs/aggregate")
      .query({ since: at(60), until: at(0), bucket: "1m" });
    expect(response.status).toBe(400);
  });
});
