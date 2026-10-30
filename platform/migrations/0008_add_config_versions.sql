CREATE TABLE "config"."versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"document" jsonb NOT NULL,
	"document_hash" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "versions_app_number_key" UNIQUE("app_id","number")
);
--> statement-breakpoint
ALTER TABLE "config"."versions" ADD CONSTRAINT "versions_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;