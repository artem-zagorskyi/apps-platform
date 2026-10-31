CREATE SCHEMA "webhooks";
--> statement-breakpoint
CREATE TABLE "webhooks"."deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "webhooks"."endpoints" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "webhooks"."deliveries" ADD CONSTRAINT "deliveries_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks"."endpoints" ADD CONSTRAINT "endpoints_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_app_created_idx" ON "webhooks"."deliveries" USING btree ("app_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "identity"."user_merges" DROP COLUMN "notified_at";