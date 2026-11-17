CREATE TYPE "public"."fulfillment_status" AS ENUM('unfulfilled', 'partial', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'authorized', 'paid', 'refunded', 'failed');--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"variant_title_ar" text,
	"variant_title_en" text,
	"sku" text,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"line_total_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_number" integer NOT NULL,
	"customer_user_id" uuid,
	"cart_id" uuid,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"fulfillment_status" "fulfillment_status" DEFAULT 'unfulfilled' NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"shipping_name" text NOT NULL,
	"address_line1" text NOT NULL,
	"address_line2" text,
	"city" text NOT NULL,
	"region" text,
	"country_code" text DEFAULT 'EG' NOT NULL,
	"notes" text,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"subtotal_minor" integer DEFAULT 0 NOT NULL,
	"shipping_minor" integer DEFAULT 0 NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"payment_method" text DEFAULT 'cash_on_delivery' NOT NULL,
	"payment_reference" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_number_key" ON "orders" USING btree ("store_id","order_number");--> statement-breakpoint
CREATE INDEX "orders_store_customer_idx" ON "orders" USING btree ("store_id","customer_user_id");--> statement-breakpoint
CREATE INDEX "orders_store_placed_idx" ON "orders" USING btree ("store_id","placed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_cart_key" ON "orders" USING btree ("store_id","cart_id");
-- Row-level security: an order is the most sensitive row in a store, and the
-- policies are enabled (and forced) in the same migration that creates the
-- table, so there is never a window where the table exists unprotected.
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "orders_tenant_isolation" ON "orders"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "orders_platform_scoped" ON "orders"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "order_items_tenant_isolation" ON "order_items"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "order_items_platform_scoped" ON "order_items"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());
