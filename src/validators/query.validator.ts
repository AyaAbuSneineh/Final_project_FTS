import { BadRequestError } from "../errors.js";
import type {AttributeFilter,LogQueryFilters} from "../types.js";
import { decodeCursor } from "../utils/cursor.js";

import {isValidIsoTimestamp,isValidLevel} from "./log.validator.js";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

export function validateLogQuery(query: unknown): LogQueryFilters {
  if (typeof query !== "object" || query === null || Array.isArray(query)){
    throw new BadRequestError("invalid query parameters",);
  }
  const params = query as Record<string, unknown>;

  const attributes: AttributeFilter[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith("attr.")) {
      const attributeKey = key.slice(5);

      if (attributeKey.length === 0) {
        throw new BadRequestError("attribute key cannot be empty");
      }

      if (typeof value !== "string") {
        throw new BadRequestError(`invalid attribute filter: ${key}`);
      }

      attributes.push({
        key: attributeKey,
        value,
      });

      continue;
    }

    const allowedParameters = [
      "service",
      "level",
      "since",
      "until",
      "q",
      "limit",
      "cursor",
    ];

    if (!allowedParameters.includes(key)) {
      throw new BadRequestError(`unknown query parameter: ${key}`);
    }
  }

  const filters: LogQueryFilters = {
    attributes,
    limit: DEFAULT_LIMIT,
  };

  // service
  if (params.service !== undefined) {
    if (typeof params.service !== "string") {
      throw new BadRequestError("service must be a string");
    }

    filters.service = params.service;
  }

  // level
  if (params.level !== undefined) {
    if (!isValidLevel(params.level)) {
      throw new BadRequestError("invalid level");
    }

    filters.level = params.level;
  }

  // since
  if (params.since !== undefined) {
    if (typeof params.since !== "string" || isValidIsoTimestamp(params.since)){
      throw new BadRequestError("since must be a valid ISO 8601 timestamp");
    }

    filters.since = new Date(params.since);
  }

  // until
  if (params.until !== undefined) {
    if (typeof params.until !== "string" ||!isValidIsoTimestamp(params.until)){
      throw new BadRequestError("until must be a valid ISO 8601 timestamp");
    }
    filters.until = new Date(params.until);
  }

  // q
  if (params.q !== undefined) {
    if (typeof params.q !== "string") {
      throw new BadRequestError("q must be a string");
    }

    filters.q = params.q;
  }

  // limit
  if (params.limit !== undefined) {
    if (typeof params.limit !== "string") {
      throw new BadRequestError("limit must be an integer between 1 and 1000");
    }

    const limit = Number(params.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT){
      throw new BadRequestError("limit must be an integer between 1 and 1000");
    }

    filters.limit = limit;
  }

  // cursor
  if (params.cursor !== undefined) {
    if (typeof params.cursor !== "string") {
        throw new BadRequestError("invalid cursor");
    }

    const cursor = decodeCursor(params.cursor);

    if (cursor === null) {
      throw new BadRequestError("invalid cursor");
    }

    filters.cursor = cursor;
  }

  return filters;
}