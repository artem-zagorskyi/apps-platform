CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE TYPE "identity"."ad_tracking_status" AS ENUM('authorized', 'denied', 'restricted', 'not_determined', 'unavailable');--> statement-breakpoint
CREATE TYPE "identity"."consent_purpose" AS ENUM('ads', 'analytics', 'personalization');--> statement-breakpoint
CREATE TYPE "identity"."consent_source" AS ENUM('first_launch', 'reprompt', 'settings', 'consent_or_pay');--> statement-breakpoint
CREATE TYPE "identity"."merge_strategy" AS ENUM('keep_target', 'keep_source', 'merge');--> statement-breakpoint
CREATE TYPE "identity"."revoke_reason" AS ENUM('logout', 'reuse_detected', 'merged', 'account_deleted', 'admin');--> statement-breakpoint
CREATE TYPE "identity"."user_status" AS ENUM('active', 'merged', 'deletion_pending', 'deleted');--> statement-breakpoint
CREATE TABLE "identity"."auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "apps"."auth_provider" NOT NULL,
	"provider_subject" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"email_is_private_relay" boolean DEFAULT false NOT NULL,
	"apple_refresh_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_provider_account_key" UNIQUE("app_id","provider","provider_subject"),
	CONSTRAINT "auth_identities_user_provider_key" UNIQUE("user_id","provider")
);
--> statement-breakpoint
CREATE TABLE "identity"."consents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"purpose" "identity"."consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"region" text NOT NULL,
	"source" "identity"."consent_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	"app_version" text NOT NULL,
	"app_build" text NOT NULL,
	"os_version" text NOT NULL,
	"device_manufacturer" text,
	"device_model" text,
	"screen_width" integer,
	"screen_height" integer,
	"screen_density" real,
	"ram_mb" integer,
	"storage_free_mb" integer,
	"locale" text,
	"timezone" text,
	"install_source" text,
	"notifications_enabled" boolean,
	"ad_tracking" "identity"."ad_tracking_status" DEFAULT 'not_determined' NOT NULL,
	"country" text,
	"region" text,
	"city" text,
	"geo_lat" real,
	"geo_lon" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rotated_at" timestamp with time zone,
	"replaced_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "identity"."revoke_reason",
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "sessions_revoke_consistent" CHECK (("identity"."sessions"."revoked_at" is null) = ("identity"."sessions"."revoke_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "identity"."user_merges" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"source_user_id" uuid NOT NULL,
	"target_user_id" uuid NOT NULL,
	"installation_id" uuid NOT NULL,
	"strategy" "identity"."merge_strategy" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone,
	CONSTRAINT "user_merges_source_key" UNIQUE("source_user_id"),
	CONSTRAINT "user_merges_not_self" CHECK ("identity"."user_merges"."source_user_id" <> "identity"."user_merges"."target_user_id")
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"status" "identity"."user_status" DEFAULT 'active' NOT NULL,
	"merged_into" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deletion_requested_at" timestamp with time zone,
	"deletion_scheduled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_id_app_id_key" UNIQUE("id","app_id"),
	CONSTRAINT "users_merged_into_matches_status" CHECK (("identity"."users"."status" = 'merged') = ("identity"."users"."merged_into" is not null))
);
--> statement-breakpoint
ALTER TABLE "identity"."auth_identities" ADD CONSTRAINT "auth_identities_user_fk" FOREIGN KEY ("user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consents" ADD CONSTRAINT "consents_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "identity"."installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."consents" ADD CONSTRAINT "consents_user_fk" FOREIGN KEY ("user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."installations" ADD CONSTRAINT "installations_user_fk" FOREIGN KEY ("user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."installations" ADD CONSTRAINT "installations_app_platform_fk" FOREIGN KEY ("app_id","platform") REFERENCES "apps"."app_platforms"("app_id","platform") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "identity"."installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_replaced_by_fk" FOREIGN KEY ("replaced_by") REFERENCES "identity"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_merges" ADD CONSTRAINT "user_merges_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "identity"."installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_merges" ADD CONSTRAINT "user_merges_source_fk" FOREIGN KEY ("source_user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_merges" ADD CONSTRAINT "user_merges_target_fk" FOREIGN KEY ("target_user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD CONSTRAINT "users_merged_into_fk" FOREIGN KEY ("merged_into","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_user_purpose_idx" ON "identity"."consents" USING btree ("user_id","purpose","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "installations_user_id_idx" ON "identity"."installations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_id_idx" ON "identity"."sessions" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "identity"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_deletion_due_idx" ON "identity"."users" USING btree ("deletion_scheduled_at") WHERE "identity"."users"."status" = 'deletion_pending';