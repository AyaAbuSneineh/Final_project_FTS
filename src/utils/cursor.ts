import type { LogCursor } from "../types.js";
import {isValidIsoTimestamp} from "../validators/log.validator.js";

export function encodeCursor(cursor: LogCursor): string {
  const payload = JSON.stringify({
    timestamp: cursor.timestamp.toISOString(),
    id: cursor.id,
  });

  return Buffer
    .from(payload)
    .toString("base64url");
}

export function decodeCursor(value: string): LogCursor | null {
  try {
    if (value.length === 0 ||!/^[A-Za-z0-9_-]+$/.test(value)) {
      return null;
    }

    const decoded = Buffer
      .from(value, "base64url")
      .toString("utf8");

    const parsed: unknown = JSON.parse(decoded);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }

    const data = parsed as Record<string, unknown>;

    if (typeof data.timestamp !== "string" || !isValidIsoTimestamp(data.timestamp)){
      return null;
    }

    if (typeof data.id !== "string" || !/^\d+$/.test(data.id) ||BigInt(data.id) <= 0n){
      return null;
    }

    return {
      timestamp: new Date(data.timestamp),
      id: data.id,
    };
  } catch {
    return null;
  }
}