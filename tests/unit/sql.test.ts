import { describe, expect, it } from "vitest";

import { escapeLikePattern } from "../../src/utils/sql.js";

describe("escapeLikePattern", () => {
  it("escapes percent and underscore wildcards", () => {
    expect(escapeLikePattern("100%_off")).toBe("100\\%\\_off");
  });

  it("escapes backslashes before other escaping", () => {
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("leaves plain text untouched", () => {
    expect(escapeLikePattern("payment declined")).toBe("payment declined");
  });

  it("neutralizes a literal SQL-injection-shaped string as plain data", () => {
    const input = "'; DROP TABLE logs; --";
    expect(escapeLikePattern(input)).toBe(input);
  });
});
