import { describe, expect, it } from "vitest";

import { decodeCursor, encodeCursor } from "../../src/utils/cursor.js";

describe("cursor encode/decode", () => {
  it("round-trips a valid cursor", () => {
    const cursor = { timestamp: new Date("2026-07-20T14:32:01.123Z"), id: "42" };
    const encoded = encodeCursor(cursor);
    const decoded = decodeCursor(encoded);

    expect(decoded).toEqual(cursor);
  });

  it("produces a URL-safe token", () => {
    const encoded = encodeCursor({ timestamp: new Date(), id: "9007199254740993" });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    "not-base64url!!",
    "",
    Buffer.from("null").toString("base64url"),
    Buffer.from("[]").toString("base64url"),
    Buffer.from(JSON.stringify({ timestamp: "not-a-date", id: "1" })).toString("base64url"),
    Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), id: "abc" })).toString("base64url"),
    Buffer.from(JSON.stringify({ timestamp: new Date().toISOString(), id: "0" })).toString("base64url"),
    Buffer.from(JSON.stringify({ timestamp: new Date().toISOString() })).toString("base64url"),
  ])("rejects malformed cursor payload: %s", (value) => {
    expect(decodeCursor(value)).toBeNull();
  });
});
