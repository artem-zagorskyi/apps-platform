CREATE TABLE "billing"."catalog_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"catalog" jsonb NOT NULL,
	"summary" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_versions_app_number_key" UNIQUE("app_id","number")
);
--> statement-breakpoint
ALTER TABLE "billing"."catalog_versions" ADD CONSTRAINT "catalog_versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;