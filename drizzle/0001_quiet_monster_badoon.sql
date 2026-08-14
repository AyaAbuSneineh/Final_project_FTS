CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "log_count_rollups_1m" (
	"bucket_start" timestamp with time zone NOT NULL,
	"service" text NOT NULL,
	"level" text NOT NULL,
	"log_count" bigint NOT NULL,
	CONSTRAINT "log_count_rollups_1m_pk" PRIMARY KEY("bucket_start","service","level")
);
--> statement-breakpoint
CREATE INDEX "log_count_rollups_1m_bucket_idx" ON "log_count_rollups_1m" USING btree ("bucket_start");--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_id_idx" ON "logs" USING btree ("service","timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "logs_message_trgm_idx" ON "logs" USING gin ("message" gin_trgm_ops);