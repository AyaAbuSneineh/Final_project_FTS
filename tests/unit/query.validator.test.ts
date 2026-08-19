import { describe, expect, it } from "vitest";

import { validateLogQuery } from "../../src/validators/query.validator.js";
import { encodeCursor } from "../../src/utils/cursor.js";
import { BadRequestError } from "../../src/errors.js";

describe("validateLogQuery", () => {
  it("applies defaults when no parameters are given", () => {
    const filters = validateLogQuery({});

    expect(filters.limit).toBe(100);
    expect(filters.attributes).toEqual([]);
    expect(filters.service).toBeUndefined();
    expect(filters.cursor).toBeUndefined();
  });

  it("parses service, level, since, until, q, and limit together", () => {
    const filters = validateLogQuery({
      service: "checkout",
      level: "error",
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      q: "declined",
      limit: "50",
    });

    expect(filters.service).toBe("checkout");
    expect(filters.level).toBe("error");
    expect(filters.since).toEqual(new Date("2026-07-20T14:00:00Z"));
    expect(filters.until).toEqual(new Date("2026-07-20T15:00:00Z"));
    expect(filters.q).toBe("declined");
    expect(filters.limit).toBe(50);
  });

  it("collects attr.<key> filters", () => {
    const filters = validateLogQuery({ "attr.user_id": "42", "attr.region": "eu-west" });

    expect(filters.attributes).toEqual([
      { key: "user_id", value: "42" },
      { key: "region", value: "eu-west" },
    ]);
  });

  it("rejects an empty attribute key", () => {
    expect(() => validateLogQuery({ "attr.": "42" })).toThrow(BadRequestError);
  });

  it("rejects an unknown query parameter", () => {
    expect(() => validateLogQuery({ foo: "bar" })).toThrow(BadRequestError);
  });

  it("rejects an invalid level", () => {
    expect(() => validateLogQuery({ level: "critical" })).toThrow(BadRequestError);
  });

  it("rejects an invalid timestamp", () => {
    expect(() => validateLogQuery({ since: "not-a-date" })).toThrow(BadRequestError);
  });

  it("rejects until earlier than since", () => {
    expect(() =>
      validateLogQuery({
        since: "2026-07-20T15:00:00Z",
        until: "2026-07-20T14:00:00Z",
      }),
    ).toThrow(BadRequestError);
  });

  it("rejects a non-numeric limit", () => {
    expect(() => validateLogQuery({ limit: "abc" })).toThrow(BadRequestError);
  });

  it.each(["0", "1001", "-5", "1.5"])("rejects limit=%s as out of range", (limit) => {
    expect(() => validateLogQuery({ limit })).toThrow(BadRequestError);
  });

  it("accepts limit at the boundaries", () => {
    expect(validateLogQuery({ limit: "1" }).limit).toBe(1);
    expect(validateLogQuery({ limit: "1000" }).limit).toBe(1000);
  });

  it("round-trips a valid cursor", () => {
    const cursor = encodeCursor({ timestamp: new Date("2026-07-20T14:32:01.123Z"), id: "42" });
    const filters = validateLogQuery({ cursor });

    expect(filters.cursor).toEqual({
      timestamp: new Date("2026-07-20T14:32:01.123Z"),
      id: "42",
    });
  });

  it("rejects a malformed cursor", () => {
    expect(() => validateLogQuery({ cursor: "not-a-real-cursor!!" })).toThrow(BadRequestError);
  });

  it("rejects a cursor that decodes to garbage", () => {
    const garbage = Buffer.from("not json").toString("base64url");
    expect(() => validateLogQuery({ cursor: garbage })).toThrow(BadRequestError);
  });
});
