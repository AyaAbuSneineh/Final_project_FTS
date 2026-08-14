import {and,eq,gte,lt,or,sql,type SQL,} from "drizzle-orm";

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
      // expression logs.attributes ->> attribute.key = attribute.value
      // --> JSONB operator ->> extracts the value of the specified key from the JSONB column logs.attributes as text
      // -> JSON operator -> extracts the value of the specified key from the JSONB column logs.attributes as JSON
    );
  }

  if (filters.cursor !== undefined) { 
    // cursor represents the last log entry retrieved in the previous query, used for pagination
    const cursorId = BigInt(filters.cursor.id);

    conditions.push(
      or( 
// expression (logs.timestamp < filters.cursor.timestamp) OR 
// (logs.timestamp = filters.cursor.timestamp AND logs.id < cursorId) 
        lt(logs.timestamp, filters.cursor.timestamp),
        and( 
// when the timestamp is equal, we need to compare the id to ensure we get the next set of logs
          eq(logs.timestamp, filters.cursor.timestamp),
          lt(logs.id, cursorId),
        ),
      )!,
    );
  }
  // Combine all conditions using AND operator
  return and(...conditions);
}