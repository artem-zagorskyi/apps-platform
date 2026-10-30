CREATE SCHEMA "config";
--> statement-breakpoint
CREATE TABLE "config"."parameter_schemas" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"schema" jsonb NOT NULL,
	"schema_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parameter_schemas_app_hash_key" UNIQUE("app_id","schema_hash")
);
--> statement-breakpoint
ALTER TABLE "config"."parameter_schemas" ADD CONSTRAINT "parameter_schemas_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "parameter_schemas_app_created_idx" ON "config"."parameter_schemas" USING btree ("app_id","created_at" DESC NULLS LAST);