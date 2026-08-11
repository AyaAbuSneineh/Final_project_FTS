import type {Request,Response} from "express";

import {getLogs, ingestLogBatch} from "../services/logs.service.js";
import { validateLogQuery } from "../validators/query.validator.js";

export async function ingestLogs(req: Request,res: Response,): Promise<void> {
  const result = await ingestLogBatch(req.body);
  res.status(200).json(result);
}
export async function queryLogs(req: Request,res: Response): Promise<void> {
  const filters = validateLogQuery(req.query);

  const result = await getLogs(filters);

  res.status(200).json(result);
}