CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE TYPE "billing"."product_kind" AS ENUM('subscription');--> statement-breakpoint
CREATE TYPE "billing"."purchase_event_kind" AS ENUM('registered', 'renewed', 'state_changed', 'transferred', 'refunded', 'acknowledged', 'anonymized');--> statement-breakpoint
CREATE TYPE "billing"."purchase_event_source" AS ENUM('client', 'notification', 'reconcile', 'merge', 'deletion');--> statement-breakpoint
CREATE TYPE "billing"."purchase_state" AS ENUM('pending', 'active', 'grace_period', 'on_hold', 'paused', 'canceled', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "billing"."store" AS ENUM('google_play', 'app_store');--> statement-breakpoint
CREATE TABLE "billing"."products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"store" "billing"."store" NOT NULL,
	"product_id" text NOT NULL,
	"kind" "billing"."product_kind" NOT NULL,
	"entitlements" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "products_app_store_product_key" UNIQUE("app_id","store","product_id")
);
--> statement-breakpoint
CREATE TABLE "billing"."purchase_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"kind" "billing"."purchase_event_kind" NOT NULL,
	"source" "billing"."purchase_event_source" NOT NULL,
	"from_state" "billing"."purchase_state",
	"to_state" "billing"."purchase_state",
	"from_user_id" uuid,
	"to_user_id" uuid,
	"details" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing"."purchases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"app_id" uuid NOT NULL,
	"user_id" uuid,
	"store" "billing"."store" NOT NULL,
	"purchase_key" text NOT NULL,
	"previous_key" text,
	"store_account_ref" text,
	"product_id" text NOT NULL,
	"state" "billing"."purchase_state" NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"auto_renewing" boolean NOT NULL,
	"price_micros" bigint,
	"currency" text,
	"country" text,
	"test" boolean DEFAULT false NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"store_payload" jsonb,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"anonymized_at" timestamp with time zone,
	CONSTRAINT "purchases_store_key" UNIQUE("store","purchase_key")
);
--> statement-breakpoint
ALTER TABLE "billing"."products" ADD CONSTRAINT "products_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."purchase_events" ADD CONSTRAINT "purchase_events_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "billing"."purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."purchases" ADD CONSTRAINT "purchases_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "apps"."apps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."purchases" ADD CONSTRAINT "purchases_user_fk" FOREIGN KEY ("user_id","app_id") REFERENCES "identity"."users"("id","app_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_events_purchase_idx" ON "billing"."purchase_events" USING btree ("purchase_id","occurred_at");--> statement-breakpoint
CREATE INDEX "purchase_events_app_time_idx" ON "billing"."purchase_events" USING btree ("app_id","occurred_at");--> statement-breakpoint
CREATE INDEX "purchases_user_idx" ON "billing"."purchases" USING btree ("app_id","user_id");--> statement-breakpoint
CREATE INDEX "purchases_state_expires_idx" ON "billing"."purchases" USING btree ("state","expires_at");