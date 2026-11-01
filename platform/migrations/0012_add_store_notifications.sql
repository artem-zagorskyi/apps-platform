CREATE TABLE "billing"."store_notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store" "billing"."store" NOT NULL,
	"message_id" text NOT NULL,
	"package_name" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"error" text,
	CONSTRAINT "store_notifications_message_key" UNIQUE("store","message_id")
);
--> statement-breakpoint
CREATE INDEX "store_notifications_received_idx" ON "billing"."store_notifications" USING btree ("received_at");