CREATE SCHEMA "events";
--> statement-breakpoint
CREATE TABLE "events"."tracking_plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"plan" jsonb NOT NULL,
	"plan_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_plans_app_hash_key" UNIQUE("app_id","plan_hash")
);
--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD CONSTRAINT "tracking_plans_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tracking_plans_app_created_idx" ON "events"."tracking_plans" USING btree ("app_id","created_at" DESC NULLS LAST);