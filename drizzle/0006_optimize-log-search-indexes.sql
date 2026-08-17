CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "logs_message_trgm_idx"
ON "logs"
USING GIN ("message" gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "logs_attributes_gin_idx"
ON "logs"
USING GIN ("attributes" jsonb_path_ops);