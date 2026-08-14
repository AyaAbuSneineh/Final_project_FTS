import type {
  LogValidationResult,
  ValidLogInput,
  LogAttributes,
  LogLevel,
} from "../types.js";
import type { IngestionConfig } from "../config/ingestion.config.js";

const VALID_LEVELS: LogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
];

const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidIsoTimestamp(value: string): boolean {
//Regular expression to match ISO 8601 timestamps with optional milliseconds and timezone offset
  const isoTimestampPattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
    // year - month - day T hour: minute: second . milliseconds Z or +hh:mm or -hh:mm
    // (?:\.\d{1,3})? is optional allowing for milliseconds with 1,2,3 digits
    // (?:Z|[+-]\d{2}:\d{2}) timezone offset can be Z or +hh:mm or -hh:mm
  if (!isoTimestampPattern.test(value)) {  // like match in python
    return false;
  }

  return !Number.isNaN(new Date(value).getTime());
}

export function parseIsoTimestamp(value: string): Date | null {
  if (!ISO_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    return null;
  }

  return timestamp;
}

export function isValidLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    VALID_LEVELS.includes(value as LogLevel)
  );
}

function validateAttributes(value: unknown, config: IngestionConfig): string | null {
  if (typeof value !== "object" ||value === null ||Array.isArray(value)) {
    return "attributes must be a flat object containing only string, number, or boolean values";
  }

  const entries = Object.entries(value);

  if (entries.length > config.maxAttributesPerLog) {
    return `attributes must contain at most ${config.maxAttributesPerLog} keys`;
  }

  for (const [attributeKey, attributeValue] of entries) {
    if (attributeKey.length === 0) {
      return "attribute keys must be non-empty strings";
    }

    if (attributeKey.length > config.maxAttributeKeyLength) {
      return `attribute keys must be at most ${config.maxAttributeKeyLength} characters`;
    }

    if (
      typeof attributeValue !== "string" &&
      typeof attributeValue !== "number" &&
      typeof attributeValue !== "boolean"
    ) {
      return "attributes must be a flat object containing only string, number, or boolean values";
    }

    if (typeof attributeValue === "number" && !Number.isFinite(attributeValue)) {
      return "attribute number values must be finite";
    }

    if (
      typeof attributeValue === "string" &&
      attributeValue.length > config.maxAttributeStringValueLength
    ) {
      return `attribute string values must be at most ${config.maxAttributeStringValueLength} characters`;
    }
  }

  return null;
}

export function validateLogEntry(
  value: unknown,
  fiveMinutesFromNow: number,
  config: IngestionConfig,
): LogValidationResult {
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
  const timestamp = parseIsoTimestamp(log.timestamp)
  if (timestamp === null) {
    return {
      valid: false,
      reason: "timestamp must be a valid ISO 8601 timestamp",
    };
  }


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

  if (log.service.length > config.maxServiceLength) {
    return {
      valid: false,
      reason: `service must be at most ${config.maxServiceLength} characters`,
    };
  }

  // message
  if (typeof log.message !== "string" ||log.message.length === 0){
    return {
      valid: false,
      reason: "message must be a non-empty string",
    };
  }

  if (log.message.length > config.maxMessageLength) {
    return {
      valid: false,
      reason: `message must be at most ${config.maxMessageLength} characters`,
    };
  }

  // attributes
  //const attributes = log.attributes ?? {};
  const attributes = log.attributes === undefined ? {} : log.attributes;

  const attributeValidationError = validateAttributes(attributes, config);

  if (attributeValidationError !== null) {
    return {
      valid: false,
      reason: attributeValidationError,
    };
  }

  const validLog: ValidLogInput = {
    timestamp,
    level: log.level,
    service: log.service,
    message: log.message,
    attributes: attributes as LogAttributes,
  };

  return {
    valid: true,
    log: validLog,
  };
}
