import express from "express";

import { healthCheck  } from "./controllers/health_controller.js";
import { ingestLogs, queryLogs ,aggregateLogs} from "./controllers/logs.controller.js";
import { errorMiddleware } from "./middleware/error.middleware.js";

export const app = express();

// 10,000 logs (MAX_LOGS_PER_BATCH) at a realistic ~1KB/entry (message + a few
// attributes) is already ~10MB — 5mb was rejecting legitimately-sized full batches
// with 413 before validation ever ran. This doesn't cover the pathological worst
// case (every log maxed out on message/attribute limits, which is a memory
// problem independent of this limit), just realistic traffic.
app.use(express.json({
    limit: "10mb",
  }),
);

app.get("/health", healthCheck);

app.post("/logs", ingestLogs);
app.get("/logs", queryLogs);
app.get("/logs/aggregate", aggregateLogs);

app.use(errorMiddleware);