import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";

import { app } from "../../src/app.js";
import { ensureMigrated } from "./setup.js";

beforeAll(async () => {
  await ensureMigrated();
});

describe("GET /health", () => {
  it("returns 200 once the database is reachable and migrations have run", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
  });
});
