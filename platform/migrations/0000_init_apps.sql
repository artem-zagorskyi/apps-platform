CREATE SCHEMA "apps";
--> statement-breakpoint
CREATE TYPE "apps"."app_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "apps"."auth_provider" AS ENUM('google', 'apple');--> statement-breakpoint
CREATE TYPE "apps"."consent_mode" AS ENUM('none', 'optional', 'consent_or_pay');--> statement-breakpoint
CREATE TYPE "apps"."platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "apps"."app_platforms" (
	"app_id" uuid NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	"bundle_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_platforms_app_id_platform_pk" PRIMARY KEY("app_id","platform")
);
--> statement-breakpoint
CREATE TABLE "apps"."apps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" "apps"."app_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "apps"."consent_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"region" text NOT NULL,
	"mode" "apps"."consent_mode" NOT NULL,
	"policy_version" text NOT NULL,
	"reprompt_after_days" integer DEFAULT 180 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_policies_app_id_region_unique" UNIQUE("app_id","region")
);
--> statement-breakpoint
CREATE TABLE "apps"."oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"platform" "apps"."platform" NOT NULL,
	"provider" "apps"."auth_provider" NOT NULL,
	"client_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_clients_app_id_provider_client_id_unique" UNIQUE("app_id","provider","client_id")
);
--> statement-breakpoint
ALTER TABLE "apps"."app_platforms" ADD CONSTRAINT "app_platforms_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps"."consent_policies" ADD CONSTRAINT "consent_policies_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps"."oauth_clients" ADD CONSTRAINT "oauth_clients_app_id_platform_app_platforms_app_id_platform_fk" FOREIGN KEY ("app_id","platform") REFERENCES "apps"."app_platforms"("app_id","platform") ON DELETE no action ON UPDATE no action;