import { BadRequestError } from "../errors.js";
import { insertLogs } from "../repositories/logs.repository.js";
import { validateLogEntry } from "../validators/log.validator.js";

import type {IngestLogsResult,RejectedLog,ValidLogInput,} from "../types.js";

export async function ingestLogBatch(body: unknown,): Promise<IngestLogsResult> {
  if (typeof body !== "object" ||body === null ||Array.isArray(body)){
    throw new BadRequestError("request body must be an object");
  }

  const requestBody = body as Record<string, unknown>;

  if (!Array.isArray(requestBody.logs)) {
    throw new BadRequestError("request body must contain a logs array");
  }

  const validLogs: ValidLogInput[] = [];
  const rejectedLogs: RejectedLog[] = [];

  for (let index = 0; index < requestBody.logs.length;index++){
    const result = validateLogEntry(requestBody.logs[index],);

    if (result.valid) {
      validLogs.push(result.log);
    } else {
      rejectedLogs.push({index,reason: result.reason,});
    }
  }

  if (validLogs.length === 0) {
    throw new BadRequestError("all log entries were rejected",
      {
        accepted: 0,
        rejected: rejectedLogs,
      },
    );
  }

  await insertLogs(validLogs);
  return {
    accepted: validLogs.length,
    rejected: rejectedLogs,
  };
}