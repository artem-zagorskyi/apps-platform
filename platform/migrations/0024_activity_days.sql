CREATE TABLE "identity"."activity_days" (
	"app_id" uuid NOT NULL,
	"day" date NOT NULL,
	"installation_id" uuid NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	CONSTRAINT "activity_days_pkey" PRIMARY KEY("app_id","day","installation_id")
);
--> statement-breakpoint
ALTER TABLE "identity"."activity_days" ADD CONSTRAINT "activity_days_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;