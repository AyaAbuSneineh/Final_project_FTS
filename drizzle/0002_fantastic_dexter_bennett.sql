CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
--> statement-breakpoint
CREATE INDEX "logs_attr_user_id_idx" ON "logs" USING btree (("attributes" ->> 'user_id'));--> statement-breakpoint
CREATE INDEX "logs_attr_region_idx" ON "logs" USING btree (("attributes" ->> 'region'));