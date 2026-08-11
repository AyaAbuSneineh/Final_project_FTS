import express from "express";

import { healthCheck  } from "./controllers/health_controller.js";
import { ingestLogs } from "./controllers/logs.controller.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

export const app = express();

//app.use(express.json());
app.use(express.json({
    limit: "5mb",
  }),
);

app.get("/health", healthCheck);
app.post("/logs", ingestLogs);
app.use(errorMiddleware);