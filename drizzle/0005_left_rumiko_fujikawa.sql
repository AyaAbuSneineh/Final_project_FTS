DROP INDEX "logs_timestamp_id_idx";--> statement-breakpoint
DROP INDEX "logs_service_timestamp_id_idx";--> statement-breakpoint
CREATE INDEX "logs_timestamp_id_idx" ON "logs" USING btree ("timestamp" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_id_idx" ON "logs" USING btree ("service","timestamp" DESC NULLS FIRST,"id" DESC NULLS FIRST);