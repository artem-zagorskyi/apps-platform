ALTER TABLE "config"."parameter_schemas" DROP CONSTRAINT "parameter_schemas_app_hash_key";--> statement-breakpoint
DROP INDEX "config"."parameter_schemas_app_created_idx";--> statement-breakpoint
ALTER TABLE "config"."versions" ADD COLUMN "published_by" text;--> statement-breakpoint
ALTER TABLE "config"."parameter_schemas" ADD COLUMN "number" integer;--> statement-breakpoint
UPDATE "config"."parameter_schemas" AS t SET "number" = v.n
FROM (SELECT "id", row_number() OVER (PARTITION BY "app_id" ORDER BY "created_at", "id") AS n FROM "config"."parameter_schemas") AS v
WHERE t."id" = v."id";--> statement-breakpoint
ALTER TABLE "config"."parameter_schemas" ALTER COLUMN "number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "config"."parameter_schemas" ADD COLUMN "uploaded_by" text;--> statement-breakpoint
ALTER TABLE "config"."parameter_schemas" ADD CONSTRAINT "parameter_schemas_app_number_key" UNIQUE("app_id","number");