CREATE TABLE "config"."drafts" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"base_version" integer,
	"document" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config"."drafts" ADD CONSTRAINT "drafts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;