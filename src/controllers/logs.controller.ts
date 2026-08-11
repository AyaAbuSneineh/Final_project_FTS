import type {Request,Response} from "express";

import {ingestLogBatch} from "../services/logs.service.js";

export async function ingestLogs(req: Request,res: Response,): Promise<void> {
  const result = await ingestLogBatch(req.body);
  res.status(200).json(result);
}