-- New rows populate attributes_text directly at insert time (see
-- insertLogChunk in logs.repository.ts). This migration does not backfill
-- attributes_text for rows written before this column existed: on a table
-- already holding a large volume of data, a single-statement backfill is a
-- long-running write that competes with live ingestion for the same rows and
-- risks being killed mid-migration before it can commit. A production
-- upgrade with pre-existing data should backfill out-of-band, in batches,
-- separately from the migration step (see README "Known limitations").
ALTER TABLE "logs" ADD COLUMN "attributes_text" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "logs_attributes_text_gin_idx" ON "logs" USING gin ("attributes_text" jsonb_path_ops);