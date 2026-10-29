-- Custom SQL migration file, put your code below! --
-- Events, partitioned by month of the corrected event time.
-- No foreign keys on purpose: this table grows fastest, and ownership is
-- guaranteed by the access token at ingestion.
CREATE TABLE "events"."events" (
  "event_id" uuid NOT NULL,
  "app_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "installation_id" uuid NOT NULL,
  "session_id" uuid,
  "seq" bigint NOT NULL,
  "name" text NOT NULL,
  "category" text NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "client_occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL,
  "platform" "apps"."platform" NOT NULL,
  "app_version" text NOT NULL,
  "app_build" text NOT NULL,
  "os_version" text NOT NULL,
  "country" text,
  "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "valid" boolean NOT NULL,
  "invalid_reason" text,
  CONSTRAINT "events_category_check" CHECK ("category" IN ('essential', 'analytics'))
) PARTITION BY RANGE ("occurred_at");
--> statement-breakpoint

-- Catches events outside every month partition (e.g. a clock years off)
CREATE TABLE "events"."events_default" PARTITION OF "events"."events" DEFAULT;
--> statement-breakpoint

-- Charts and funnels: one app, one event, a time range
CREATE INDEX "events_app_name_time_idx" ON "events"."events" ("app_id", "name", "occurred_at");
--> statement-breakpoint

-- History of one person
CREATE INDEX "events_user_time_idx" ON "events"."events" ("user_id", "occurred_at");
--> statement-breakpoint

-- Creates partitions for the current month and the next ones (UTC months).
-- Safe to call any number of times.
CREATE OR REPLACE FUNCTION "events"."ensure_partitions"(months_ahead integer DEFAULT 2)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  first_month timestamp := date_trunc('month', now() AT TIME ZONE 'UTC');
  month_from timestamp;
BEGIN
  FOR i IN 0..months_ahead LOOP
    month_from := first_month + make_interval(months => i);
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS events.%I PARTITION OF events.events FOR VALUES FROM (%L) TO (%L)',
      'events_' || to_char(month_from, 'YYYY_MM'),
      month_from AT TIME ZONE 'UTC',
      (month_from + interval '1 month') AT TIME ZONE 'UTC'
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

SELECT "events"."ensure_partitions"();