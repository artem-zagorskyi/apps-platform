CREATE TABLE "events"."rejection_counts" (
	"app_id" uuid NOT NULL,
	"day" date NOT NULL,
	"reason" text NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	"app_version" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rejection_counts_pkey" PRIMARY KEY("app_id","day","reason","platform","app_version")
);
--> statement-breakpoint
ALTER TABLE "events"."rejection_counts" ADD CONSTRAINT "rejection_counts_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;