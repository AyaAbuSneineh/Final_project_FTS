import express from "express";

import { healthCheck } from "./controllers/health-controller.js";

export const app = express();

app.use(express.json());

app.get("/health", healthCheck);