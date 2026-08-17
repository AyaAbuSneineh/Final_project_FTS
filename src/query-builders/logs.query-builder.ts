import {and,eq,gte,lt,sql,type SQL,or} from "drizzle-orm";

import { logs } from "../db/schema.js";
import type { LogQueryFilters } from "../types.js";
import { escapeLikePattern } from "../utils/sql.js";

export function buildLogConditions(filters: LogQueryFilters): SQL | undefined {
    // SQL[] store the conditions for the query
  const conditions: SQL[] = []; 

  if (filters.service !== undefined) { 
    conditions.push(
      eq(logs.service, filters.service), //expression  logs.service = filters.service
    );
  }

  if (filters.level !== undefined) {
    conditions.push(
      eq(logs.level, filters.level), // expression logs.level = filters.level
    );
  }

  if (filters.since !== undefined) {
    conditions.push(
      gte(logs.timestamp, filters.since), // expression logs.timestamp >= filters.since
    );
  }

  if (filters.until !== undefined) {
    conditions.push(
      lt(logs.timestamp, filters.until), // expression logs.timestamp < filters.until
    );
  }

  if (filters.q !== undefined) {
    const escapedQuery = escapeLikePattern(filters.q);

    conditions.push(
      // Escape % / _ / \ in the user's search term so a literal "%" or "_" in q is
      // matched as a literal character instead of behaving as a wildcard.
      sql`${logs.message} ILIKE ${`%${escapedQuery}%`} ESCAPE '\\'`,
    );
  }
  
  for (const attribute of filters.attributes) {
    conditions.push(
    sql`${logs.attributes} ->> ${attribute.key} = ${attribute.value}`,
  );
  }

  if (filters.cursor !== undefined) { 
    // cursor represents the last log entry retrieved in the previous query, used for pagination
    const cursorId = BigInt(filters.cursor.id);
    conditions.push(
    sql`(${logs.timestamp}, ${logs.id}) < (${filters.cursor.timestamp}, ${cursorId})`,
    );
  }
  // Combine all conditions using AND operator
  return and(...conditions);
}