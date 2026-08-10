CREATE TABLE "logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"timestamp" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"service" text NOT NULL,
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "logs_level_check" CHECK ("logs"."level" IN ('debug', 'info', 'warn', 'error')),
	CONSTRAINT "logs_service_not_empty_check" CHECK (char_length("logs"."service") > 0),
	CONSTRAINT "logs_message_not_empty_check" CHECK (char_length("logs"."message") > 0)
);
--> statement-breakpoint
CREATE INDEX "logs_timestamp_id_idx" ON "logs" USING btree ("timestamp" DESC NULLS LAST,"id" DESC NULLS LAST);