import type { Request, Response } from "express";

import { checkDatabaseConnection } from "../services/health_service.js";
// if DB is not connected, 
// it will throw an error and return 503 Service Unavailable
export async function healthCheck(req: Request,res: Response,): Promise<void> {
  try {
    await checkDatabaseConnection();

    res.status(200).json({status: "ok",});
  } catch {
    res.status(503).json({status: "unavailable",});
  }
}