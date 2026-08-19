import { describe, expect, it } from "vitest";

import { validateAggregateQuery } from "../../src/validators/aggregate.validator.js";
import { BadRequestError } from "../../src/errors.js";

const BASE = {
  since: "2026-07-20T14:00:00Z",
  until: "2026-07-20T15:00:00Z",
  bucket: "5m",
};

describe("validateAggregateQuery", () => {
  it("parses the minimal required parameters", () => {
    const filters = validateAggregateQuery(BASE);

    expect(filters.since).toEqual(new Date(BASE.since));
    expect(filters.until).toEqual(new Date(BASE.until));
    expect(filters.bucket).toBe("5m");
    expect(filters.groupBy).toBeUndefined();
  });

  it.each(["1m", "5m", "1h", "1d"])("accepts bucket=%s", (bucket) => {
    expect(validateAggregateQuery({ ...BASE, bucket }).bucket).toBe(bucket);
  });

  it("rejects an invalid bucket", () => {
    expect(() => validateAggregateQuery({ ...BASE, bucket: "3m" })).toThrow(BadRequestError);
  });

  it("requires since", () => {
    const { since, ...rest } = BASE;
    expect(() => validateAggregateQuery(rest)).toThrow(BadRequestError);
  });

  it("requires until", () => {
    const { until, ...rest } = BASE;
    expect(() => validateAggregateQuery(rest)).toThrow(BadRequestError);
  });

  it("rejects until earlier than since", () => {
    expect(() =>
      validateAggregateQuery({ ...BASE, since: BASE.until, until: BASE.since }),
    ).toThrow(BadRequestError);
  });

  it.each(["service", "level"])("accepts group_by=%s", (groupBy) => {
    expect(validateAggregateQuery({ ...BASE, group_by: groupBy }).groupBy).toBe(groupBy);
  });

  it("rejects an invalid group_by", () => {
    expect(() => validateAggregateQuery({ ...BASE, group_by: "region" })).toThrow(BadRequestError);
  });

  it("collects attr.<key> filters alongside other filters", () => {
    const filters = validateAggregateQuery({
      ...BASE,
      service: "checkout",
      level: "error",
      q: "declined",
      "attr.user_id": "42",
    });

    expect(filters.service).toBe("checkout");
    expect(filters.level).toBe("error");
    expect(filters.q).toBe("declined");
    expect(filters.attributes).toEqual([{ key: "user_id", value: "42" }]);
  });

  it("rejects an unknown query parameter", () => {
    expect(() => validateAggregateQuery({ ...BASE, foo: "bar" })).toThrow(BadRequestError);
  });
});
