CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'open', 'paid', 'void', 'uncollectible');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'cancelled');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"subscription_id" uuid,
	"invoice_number" integer NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"payment_method" text,
	"payment_reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"current_period_start" timestamp with time zone DEFAULT now() NOT NULL,
	"current_period_end" timestamp with time zone DEFAULT now() NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"provider" text,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_store_number_key" ON "invoices" USING btree ("store_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_store_status_idx" ON "invoices" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "invoices_due_idx" ON "invoices" USING btree ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_store_key" ON "subscriptions" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_idx" ON "subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" USING btree ("current_period_end");
-- RLS: a merchant may read their own subscription and invoices, and the
-- platform reads across all of them. The policies are the shape ADR 0003
-- prescribes -- tenant isolation for the app role, tenant-scoped platform
-- access for the platform role -- so billing follows the same rule as every
-- other table rather than inventing its own.
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscriptions_tenant_isolation" ON "subscriptions"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "subscriptions_platform_scoped" ON "subscriptions"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "invoices_tenant_isolation" ON "invoices"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "invoices_platform_scoped" ON "invoices"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());
