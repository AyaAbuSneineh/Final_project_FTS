import { BadRequestError } from "../errors.js";

import type {AggregateBucket,AggregateGroupBy,AggregateQueryFilters,AttributeFilter} from "../types.js";

import {isValidIsoTimestamp,isValidLevel} from "./log.validator.js";

const VALID_BUCKETS: AggregateBucket[] = [
  "1m",
  "5m",
  "1h",
  "1d",
];

const VALID_GROUP_BY: AggregateGroupBy[] = [
  "service",
  "level",
];

function isValidBucket(value: unknown): value is AggregateBucket {
  return (
    typeof value === "string" &&
    VALID_BUCKETS.includes(value as AggregateBucket)
  );
}

function isValidGroupBy(value: unknown): value is AggregateGroupBy {
  return (
    typeof value === "string" &&
    VALID_GROUP_BY.includes(value as AggregateGroupBy)
  );
}

export function validateAggregateQuery(query: unknown): AggregateQueryFilters {
  if (typeof query !== "object" || query === null || Array.isArray(query)){
    throw new BadRequestError("invalid query parameters");
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
      "bucket",
      "group_by",
      "q",
    ];

    if (!allowedParameters.includes(key)) {
      throw new BadRequestError(`unknown query parameter: ${key}`);
    }
  }

  if (typeof params.since !== "string" || !isValidIsoTimestamp(params.since)){
    throw new BadRequestError("since must be a valid ISO 8601 timestamp");
  }

  if (typeof params.until !== "string" || !isValidIsoTimestamp(params.until)){
    throw new BadRequestError("until must be a valid ISO 8601 timestamp");
  }

  if (!isValidBucket(params.bucket)) {
    throw new BadRequestError("bucket must be one of: 1m, 5m, 1h, 1d");
  }

  const filters: AggregateQueryFilters = {
    since: new Date(params.since),
    until: new Date(params.until),
    bucket: params.bucket,
    attributes,
  };

  if (filters.until.getTime() < filters.since.getTime()) {
    throw new BadRequestError("until must not be earlier than since");
  }

  if (params.service !== undefined) {
    if (typeof params.service !== "string") {
      throw new BadRequestError("service must be a string");
    }

    filters.service = params.service;
  }

  if (params.level !== undefined) {
    if (!isValidLevel(params.level)) {
      throw new BadRequestError("invalid level");
    }

    filters.level = params.level;
  }

  if (params.q !== undefined) {
    if (typeof params.q !== "string") {
      throw new BadRequestError("q must be a string");
    }

    filters.q = params.q;
  }

  if (params.group_by !== undefined) {
    if (!isValidGroupBy(params.group_by)) {
      throw new BadRequestError("group_by must be one of: service, level");
    }

    filters.groupBy = params.group_by;
  }

  return filters;
}