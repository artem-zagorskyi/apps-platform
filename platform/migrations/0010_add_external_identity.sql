ALTER TYPE "apps"."auth_provider" ADD VALUE 'external';--> statement-breakpoint
CREATE TABLE "apps"."identity_keys" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"kid" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "identity_keys_app_kid_key" UNIQUE("app_id","kid")
);
--> statement-breakpoint
ALTER TABLE "apps"."identity_keys" ADD CONSTRAINT "identity_keys_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;