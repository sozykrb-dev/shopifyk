CREATE TYPE "public"."cart_status" AS ENUM('active', 'converted', 'abandoned');--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"guest_token_hash" text,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"status" "cart_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"alt_en" text,
	"alt_ar" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"sku" text,
	"price_minor" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"inventory_quantity" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_line_key" ON "cart_items" USING btree ("cart_id","product_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("store_id","cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_guest_token_key" ON "carts" USING btree ("store_id","guest_token_hash");--> statement-breakpoint
CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("store_id","customer_user_id");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_sku_key" ON "product_variants" USING btree ("store_id","product_id","sku");--> statement-breakpoint
CREATE INDEX "product_variants_product_idx" ON "product_variants" USING btree ("store_id","product_id","position");
-- ===========================================================================
-- Row-Level Security for the new tenant tables.
--
-- Every table created above carries `store_id`, so it gets the same treatment
-- as `products`: FORCE RLS, plus a policy per role. FORCE is not optional --
-- without it the table owner bypasses its own policies.
-- ===========================================================================

-- product_images ------------------------------------------------------------
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_images" FORCE ROW LEVEL SECURITY;

CREATE POLICY "product_images_tenant_isolation" ON "product_images"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "product_images_platform_scoped" ON "product_images"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

-- product_variants ----------------------------------------------------------
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;

CREATE POLICY "product_variants_tenant_isolation" ON "product_variants"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "product_variants_platform_scoped" ON "product_variants"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

-- carts ---------------------------------------------------------------------
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "carts_tenant_isolation" ON "carts"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "carts_platform_scoped" ON "carts"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

-- cart_items ----------------------------------------------------------------
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "cart_items_tenant_isolation" ON "cart_items"
  FOR ALL TO "velnorix_app"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());

CREATE POLICY "cart_items_platform_scoped" ON "cart_items"
  FOR ALL TO "velnorix_platform"
  USING ("store_id" = current_tenant_id())
  WITH CHECK ("store_id" = current_tenant_id());
