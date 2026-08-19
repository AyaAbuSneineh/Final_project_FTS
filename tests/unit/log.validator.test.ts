import { describe, expect, it } from "vitest";

import { isValidIsoTimestamp, validateLogEntry } from "../../src/validators/log.validator.js";
import type { IngestionConfig } from "../../src/config/ingestion.config.js";

const config: IngestionConfig = {
  maxLogsPerBatch: 10_000,
  insertChunkSize: 5_000,
  batchingEnabled: true,
  flushIntervalMs: 50,
  flushMaxLogs: 5_000,
  maxBufferedLogs: 100_000,
  maxConcurrentFlushes: 2,
  maxServiceLength: 256,
  maxMessageLength: 8_192,
  maxAttributesPerLog: 50,
  maxAttributeKeyLength: 128,
  maxAttributeStringValueLength: 4_096,
};

const FIVE_MINUTES_FROM_NOW = Date.now() + 5 * 60 * 1000;

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timestamp: "2026-07-20T14:32:01.123Z",
    level: "error",
    service: "checkout",
    message: "payment declined",
    attributes: { user_id: "42", region: "eu-west", retries: 3 },
    ...overrides,
  };
}

describe("validateLogEntry", () => {
  it("accepts a fully valid entry", () => {
    const result = validateLogEntry(validEntry(), FIVE_MINUTES_FROM_NOW, config);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.log.level).toBe("error");
      expect(result.log.service).toBe("checkout");
      expect(result.log.attributes).toEqual({ user_id: "42", region: "eu-west", retries: 3 });
    }
  });

  it("defaults missing attributes to an empty object", () => {
    const { attributes, ...rest } = validEntry();
    const result = validateLogEntry(rest, FIVE_MINUTES_FROM_NOW, config);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.log.attributes).toEqual({});
    }
  });

  it.each([
    ["missing timestamp", { timestamp: undefined }],
    ["non-string timestamp", { timestamp: 12345 }],
    ["non-ISO timestamp", { timestamp: "not-a-date" }],
    ["missing level", { level: undefined }],
    ["invalid level", { level: "critical" }],
    ["empty service", { service: "" }],
    ["non-string service", { service: 42 }],
    ["empty message", { message: "" }],
    ["missing message", { message: undefined }],
  ])("rejects entry with %s", (_label, overrides) => {
    const result = validateLogEntry(validEntry(overrides), FIVE_MINUTES_FROM_NOW, config);
    expect(result.valid).toBe(false);
  });

  it("rejects a timestamp more than five minutes in the future", () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = validateLogEntry(validEntry({ timestamp: future }), FIVE_MINUTES_FROM_NOW, config);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toMatch(/five minutes/);
    }
  });

  it("accepts a timestamp just within five minutes in the future", () => {
    const future = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const result = validateLogEntry(validEntry({ timestamp: future }), FIVE_MINUTES_FROM_NOW, config);

    expect(result.valid).toBe(true);
  });

  it("rejects nested objects in attributes", () => {
    const result = validateLogEntry(
      validEntry({ attributes: { nested: { a: 1 } } }),
      FIVE_MINUTES_FROM_NOW,
      config,
    );

    expect(result.valid).toBe(false);
  });

  it("rejects arrays in attributes", () => {
    const result = validateLogEntry(
      validEntry({ attributes: { tags: [1, 2, 3] } }),
      FIVE_MINUTES_FROM_NOW,
      config,
    );

    expect(result.valid).toBe(false);
  });

  it("rejects attributes: null", () => {
    const result = validateLogEntry(validEntry({ attributes: null }), FIVE_MINUTES_FROM_NOW, config);
    expect(result.valid).toBe(false);
  });

  it("rejects non-finite number attribute values", () => {
    const result = validateLogEntry(
      validEntry({ attributes: { bad: Number.POSITIVE_INFINITY } }),
      FIVE_MINUTES_FROM_NOW,
      config,
    );

    expect(result.valid).toBe(false);
  });

  it("rejects an entry that is not an object", () => {
    const result = validateLogEntry("not an object", FIVE_MINUTES_FROM_NOW, config);
    expect(result.valid).toBe(false);
  });

  it("enforces the configured service length limit", () => {
    const result = validateLogEntry(
      validEntry({ service: "a".repeat(config.maxServiceLength + 1) }),
      FIVE_MINUTES_FROM_NOW,
      config,
    );

    expect(result.valid).toBe(false);
  });

  it("enforces the configured attribute count limit", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < config.maxAttributesPerLog + 1; i++) {
      attributes[`key${i}`] = "value";
    }

    const result = validateLogEntry(validEntry({ attributes }), FIVE_MINUTES_FROM_NOW, config);
    expect(result.valid).toBe(false);
  });
});

describe("isValidIsoTimestamp", () => {
  it.each([
    "2026-07-20T14:32:01.123Z",
    "2026-07-20T14:32:01Z",
    "2026-07-20T14:32:01+02:00",
  ])("accepts %s", (value) => {
    expect(isValidIsoTimestamp(value)).toBe(true);
  });

  it.each([
    "2026-07-20 14:32:01",
    "not-a-date",
    "2026-13-40T99:99:99Z",
    "",
  ])("rejects %s", (value) => {
    expect(isValidIsoTimestamp(value)).toBe(false);
  });
});
