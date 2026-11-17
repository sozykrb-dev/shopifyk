CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"intent_id" uuid,
	"type" text,
	"status" text,
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"refunded_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"redirect_url" text,
	"instructions" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events" USING btree ("store_id","provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_events_intent_idx" ON "payment_events" USING btree ("store_id","intent_id");--> statement-breakpoint
CREATE INDEX "payment_intents_order_idx" ON "payment_intents" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_intents_reference_key" ON "payment_intents" USING btree ("store_id","provider_reference");
-- Row-level security: a payment intent says how much a customer owes and where
-- they live, so it is tenant data like any other.
ALTER TABLE "payment_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_intents" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_intents_tenant_isolation" ON "payment_intents"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "payment_intents_platform_scoped" ON "payment_intents"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

ALTER TABLE "payment_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "payment_events_tenant_isolation" ON "payment_events"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "payment_events_platform_scoped" ON "payment_events"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());
