CREATE SCHEMA "admin";
--> statement-breakpoint
CREATE TYPE "admin"."role" AS ENUM('owner', 'product', 'support', 'viewer');--> statement-breakpoint
CREATE TYPE "admin"."session_revoke_reason" AS ENUM('logout', 'logout_all', 'disabled', 'password_changed');--> statement-breakpoint
CREATE TABLE "admin"."admins" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text NOT NULL,
	"totp_last_step" bigint,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_email_unique" UNIQUE("email"),
	CONSTRAINT "admins_email_lowercase" CHECK (email = lower(email))
);
--> statement-breakpoint
CREATE TABLE "admin"."audit_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_id" uuid,
	"action" text NOT NULL,
	"app_id" uuid,
	"target_type" text,
	"target_id" text,
	"reason" text,
	"before" jsonb,
	"after" jsonb,
	"details" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin"."recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_codes_admin_hash_key" UNIQUE("admin_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "admin"."role_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_id" uuid NOT NULL,
	"role" "admin"."role" NOT NULL,
	"app_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_grants_admin_app_key" UNIQUE NULLS NOT DISTINCT("admin_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "admin"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoke_reason" "admin"."session_revoke_reason",
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "admin"."audit_log" ADD CONSTRAINT "audit_log_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "admin"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."audit_log" ADD CONSTRAINT "audit_log_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."recovery_codes" ADD CONSTRAINT "recovery_codes_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "admin"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."role_grants" ADD CONSTRAINT "role_grants_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "admin"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."role_grants" ADD CONSTRAINT "role_grants_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin"."sessions" ADD CONSTRAINT "sessions_admin_id_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "admin"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_admin_idx" ON "admin"."audit_log" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_app_idx" ON "admin"."audit_log" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_admin_idx" ON "admin"."sessions" USING btree ("admin_id");