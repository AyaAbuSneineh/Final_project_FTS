import type {
  LogValidationResult,
  ValidLogInput,
  LogAttributes,
  LogLevel,
} from "../types.js";

const VALID_LEVELS: LogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
];

export function isValidIsoTimestamp(value: string): boolean {
  const isoTimestampPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

  if (!isoTimestampPattern.test(value)) {
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

export function isValidLevel(value: any): value is LogLevel {
  return (
    typeof value === "string" &&
    VALID_LEVELS.includes(value as LogLevel)
  );
}

function validateAttributes(value: unknown): value is LogAttributes {
  if (typeof value !== "object" ||value === null ||Array.isArray(value)) {
    return false;
  }

  for (const attributeValue of Object.values(value)) {
    if (
      typeof attributeValue !== "string" &&
      typeof attributeValue !== "number" &&
      typeof attributeValue !== "boolean"
    ) {
      return false;
    }
  }

  return true;
}

export function validateLogEntry(value: unknown,): LogValidationResult {
  if (typeof value !== "object" ||value === null ||Array.isArray(value)
  ) {
    return {
      valid: false,
      reason: "log entry must be an object",
    };
  }

  const log = value as Record<string, unknown>;

  // timestamp
  if (typeof log.timestamp !== "string") {
    return {
      valid: false,
      reason: "timestamp is required and must be a string",
    };
  }
  if (!isValidIsoTimestamp(log.timestamp)) {
    return {
      valid: false,
      reason: "timestamp must be a valid ISO 8601 timestamp",
    };
  }

  const timestamp = new Date(log.timestamp);
  const fiveMinutesFromNow =
    Date.now() + 5 * 60 * 1000;

  if (timestamp.getTime() > fiveMinutesFromNow) {
    return {
      valid: false,
      reason: "timestamp must not be more than five minutes in the future",
    };
  }

  // level
  if (!isValidLevel(log.level)) {
    return {
      valid: false,
      reason: `invalid level: '${String(log.level)}'`,
    };
  }

  // service
  if (typeof log.service !== "string" ||log.service.length === 0){
    return {
      valid: false,
      reason: "service must be a non-empty string",
    };
  }

  // message
  if (typeof log.message !== "string" ||log.message.length === 0){
    return {
      valid: false,
      reason: "message must be a non-empty string",
    };
  }

  // attributes
  //const attributes = log.attributes ?? {};
  const attributes = log.attributes === undefined ? {} : log.attributes;

  if (!validateAttributes(attributes)) {
    return {
      valid: false,
      reason:
        "attributes must be a flat object containing only string, number, or boolean values",
    };
  }

  const validLog: ValidLogInput = {
    timestamp,
    level: log.level,
    service: log.service,
    message: log.message,
    attributes,
  };

  return {
    valid: true,
    log: validLog,
  };
}