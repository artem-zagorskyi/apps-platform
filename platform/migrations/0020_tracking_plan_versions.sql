ALTER TABLE "events"."tracking_plans" DROP CONSTRAINT "tracking_plans_app_hash_key";--> statement-breakpoint
DROP INDEX "events"."tracking_plans_app_created_idx";--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD COLUMN "number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD CONSTRAINT "tracking_plans_app_number_key" UNIQUE("app_id","number");