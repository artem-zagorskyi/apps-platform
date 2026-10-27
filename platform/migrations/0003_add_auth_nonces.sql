CREATE TABLE "identity"."auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"installation_id" uuid NOT NULL,
	"nonce_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_nonces_nonce_hash_unique" UNIQUE("nonce_hash")
);
--> statement-breakpoint
ALTER TABLE "identity"."auth_nonces" ADD CONSTRAINT "auth_nonces_installation_id_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "identity"."installations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_nonces_installation_id_idx" ON "identity"."auth_nonces" USING btree ("installation_id");