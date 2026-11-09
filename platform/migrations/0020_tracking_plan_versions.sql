ALTER TABLE "events"."tracking_plans" DROP CONSTRAINT "tracking_plans_app_hash_key";--> statement-breakpoint
DROP INDEX "events"."tracking_plans_app_created_idx";--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "events"."tracking_plans" AS t SET "number" = v.n
FROM (SELECT "id", row_number() OVER (PARTITION BY "app_id" ORDER BY "created_at", "id") AS n FROM "events"."tracking_plans") AS v
WHERE t."id" = v."id";--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "events"."tracking_plans" ADD CONSTRAINT "tracking_plans_app_number_key" UNIQUE("app_id","number");