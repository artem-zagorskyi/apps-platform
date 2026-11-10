CREATE TABLE "events"."presence" (
	"installation_id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	"country" text,
	"city" text,
	"lat" real,
	"lon" real,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events"."presence" ADD CONSTRAINT "presence_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "presence_app_seen_idx" ON "events"."presence" USING btree ("app_id","last_seen_at");