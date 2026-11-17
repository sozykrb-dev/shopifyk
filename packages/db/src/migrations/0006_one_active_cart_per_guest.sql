DROP INDEX "carts_guest_token_key";--> statement-breakpoint
CREATE UNIQUE INDEX "carts_guest_token_key" ON "carts" USING btree ("store_id","guest_token_hash") WHERE "carts"."status" = 'active';