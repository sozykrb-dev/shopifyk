DROP INDEX "cart_items_cart_line_key";--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_variant_line_key" ON "cart_items" USING btree ("cart_id","product_id","variant_id") WHERE "cart_items"."variant_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_line_key" ON "cart_items" USING btree ("cart_id","product_id") WHERE "cart_items"."variant_id" IS NULL;