import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

import { app } from "../../src/app.js";
import { resetDb } from "./setup.js";

beforeAll(async () => {
  await resetDb();
});

beforeEach(async () => {
  await resetDb();
});

describe("POST /logs", () => {
  it("accepts a single valid log entry", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "error",
            service: "checkout",
            message: "payment declined",
            attributes: { user_id: "42", region: "eu-west", retries: 3 },
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected).toEqual([]);
  });

  it("accepts valid entries and reports the index/reason of invalid ones without failing the batch", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [
          { timestamp: new Date().toISOString(), level: "info", service: "auth", message: "ok" },
          { timestamp: new Date().toISOString(), level: "critical", service: "auth", message: "bad level" },
          { timestamp: new Date().toISOString(), level: "info", service: "", message: "bad service" },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected).toHaveLength(2);
    expect(response.body.rejected[0]).toEqual({ index: 1, reason: expect.stringContaining("critical") });
    expect(response.body.rejected[1].index).toBe(2);
  });

  it("returns 400 when every entry is rejected", async () => {
    const response = await request(app)
      .post("/logs")
      .send({ logs: [{ timestamp: "not-a-date", level: "info", service: "auth", message: "x" }] });

    expect(response.status).toBe(400);
    expect(response.body.accepted).toBe(0);
    expect(response.body.rejected).toHaveLength(1);
  });

  it("returns 400 when the logs field is missing", async () => {
    const response = await request(app).post("/logs").send({});
    expect(response.status).toBe(400);
  });

  it("returns 400 when logs is not an array", async () => {
    const response = await request(app).post("/logs").send({ logs: "not-an-array" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for malformed JSON", async () => {
    const response = await request(app)
      .post("/logs")
      .set("Content-Type", "application/json")
      .send("{not valid json");

    expect(response.status).toBe(400);
  });

  it("rejects nested attribute objects for that entry only", async () => {
    const response = await request(app)
      .post("/logs")
      .send({
        logs: [
          { timestamp: new Date().toISOString(), level: "info", service: "auth", message: "ok" },
          {
            timestamp: new Date().toISOString(),
            level: "info",
            service: "auth",
            message: "bad attrs",
            attributes: { nested: { a: 1 } },
          },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.accepted).toBe(1);
    expect(response.body.rejected).toEqual([{ index: 1, reason: expect.any(String) }]);
  });

  it("stores logs so they are immediately queryable", async () => {
    const marker = `ingest-marker-${Date.now()}`;

    const postResponse = await request(app)
      .post("/logs")
      .send({
        logs: [
          {
            timestamp: new Date().toISOString(),
            level: "warn",
            service: marker,
            message: "immediately queryable",
          },
        ],
      });

    expect(postResponse.status).toBe(200);

    const getResponse = await request(app).get("/logs").query({ service: marker });

    expect(getResponse.status).toBe(200);
    expect(getResponse.body.logs).toHaveLength(1);
    expect(getResponse.body.logs[0].message).toBe("immediately queryable");
  });
});
