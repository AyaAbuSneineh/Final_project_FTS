import type {Request,Response} from "express";

import {checkDatabaseConnection} from "../services/health_service.js";

export async function healthCheck(req: Request,res: Response): Promise<void> {
  await checkDatabaseConnection();

  res.status(200).json({status: "ok"});
}