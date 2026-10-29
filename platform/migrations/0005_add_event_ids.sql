CREATE TABLE "events"."event_ids" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
