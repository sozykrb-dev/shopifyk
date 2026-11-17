# Database schema

PostgreSQL 18. One database, one schema, `store_id` on every tenant table, and
[Row-Level Security](adr/0003-multi-tenancy-and-rls.md) doing the enforcing.

Migrations live in `packages/db/src/migrations` and are applied by
`pnpm db:migrate` (which also re-syncs the `velnorix` role's password):

| Migration                 | Contents                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| `0000_init.sql`           | Tables, enums, indexes, foreign keys                               |
| `0001_roles_and_rls.sql`  | Database roles, privileges, RLS policies, `app.current_store_id()` |
| `0002_reference_data.sql` | Platform plans, permissions, and the system roles that group them  |

## Database roles

| Role                | Login | Purpose                                                                                |
| ------------------- | ----- | -------------------------------------------------------------------------------------- |
| `velnorix`          | yes   | The only role the application connects with. Owns nothing, `NOINHERIT`, `NOBYPASSRLS`. |
| `velnorix_app`      | no    | Used inside tenant transactions; sees tenant rows through RLS only.                    |
| `velnorix_platform` | no    | Used for platform tables; sees **no** tenant rows unless a tenant is pinned.           |

Migrations run through `DATABASE_MIGRATION_URL` (the table owner). The
application must never use that URL — a connection that owns the tables bypasses
RLS by definition, so pointing the app at it would silently disable tenant
isolation.

## Tables

### Platform tables

Reachable only through the `velnorix_platform` role. No RLS, because there is
exactly one platform.

| Table                       | Purpose                                | Notes                                                                                          |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `plans`                     | Subscription plans                     | `price_minor` + `currency`; `limits` JSONB; `transaction_fee_bps` (0 until pricing is decided) |
| `stores`                    | Tenants                                | `slug` is the subdomain; status `active`/`suspended`/`closed`                                  |
| `store_domains`             | Subdomains and verified custom domains | unique `host`; one `is_primary` per store                                                      |
| `users`                     | Every identity                         | `context` ∈ the five auth contexts                                                             |
| `sessions`                  | Server-side sessions                   | only `sha256(token)` is stored; idle + absolute expiry                                         |
| `email_verification_tokens` | Email verification                     | token hash + single use (`consumed_at`)                                                        |
| `password_reset_tokens`     | Password reset                         | token hash + single use                                                                        |
| `totp_credentials`          | TOTP seeds, **encrypted at rest**      | one row per user, `confirmed_at` for enrolment                                                 |
| `recovery_codes`            | Hashed 2FA recovery codes              | single use                                                                                     |
| `permissions`               | Permission catalogue                   | primary key is the permission key, e.g. `store:products.write`                                 |
| `roles`                     | Platform and per-store roles           | `scope` ∈ `platform`/`store`; `store_id` null for system roles                                 |
| `role_permissions`          | Role → permission                      | composite primary key                                                                          |
| `store_memberships`         | User → role within a store             | unique per `(store_id, user_id)`                                                               |
| `user_platform_roles`       | User → platform role                   | composite primary key                                                                          |
| `audit_logs`                | Append-only audit trail                | actor, action, target, tenant, IP, user agent                                                  |

Two uniqueness rules on `users` are worth calling out, because they encode the
per-store customer model:

```sql
-- Platform and merchant identities are global.
UNIQUE (lower(btrim(email))) WHERE context <> 'customer'
-- The same email in two stores is two different customer accounts.
UNIQUE (store_id, lower(btrim(email))) WHERE context = 'customer'
```

`email_normalized` is a `GENERATED ALWAYS AS` column, so it cannot drift from
`email`.

### Tenant tables

Every one of these has `FORCE ROW LEVEL SECURITY` and a policy on `store_id`.

| Table            | Purpose                                             |
| ---------------- | --------------------------------------------------- |
| `products`       | Catalogue (title/description in Arabic and English) |
| `store_settings` | Theme, accent colour, locale, currency, logo        |

Later phases add `orders`, `customers`, `collections`, `discounts` and
`inventory_movements` on the same pattern: `store_id NOT NULL`, a composite
index **leading with** `store_id`, and RLS enabled in the same migration that
creates the table.

## How isolation works at runtime

```sql
BEGIN;
  SET LOCAL ROLE velnorix_app;
  SELECT set_config('app.current_store_id', '<store uuid>', true);
  -- every query now sees only this tenant's rows
COMMIT;  -- both settings disappear
```

`packages/db/src/tenant-context.ts` is the only supported way to get a handle:

- `withTenant(storeId, fn)` — tenant scope (above).
- `withPlatform(fn)` — platform scope; tenant tables return nothing.
- `withPlatformTenant(storeId, fn)` — platform role inside a tenant scope, for
  audited platform actions such as impersonation.

Two independent layers:

1. **Application** — repositories call `requireTenantId()` and add their own
   `WHERE store_id = …`. The tenant id lives in an `AsyncLocalStorage`, so it
   cannot be passed across requests by accident.
2. **Database** — RLS policies use `app.current_store_id()`. If layer 1 is ever
   wrong, layer 2 still refuses to return another tenant's rows.

Both are covered by tests: `packages/db/tests/isolation.test.ts`
deliberately tries to read across tenants, with and without a `WHERE` clause.

## Money

`integer` minor units plus an ISO-4217 `currency` code — never a float, never
`numeric`. `packages/core/src/money.ts` owns arithmetic and refuses to add
amounts in different currencies. New stores default to `EGP`.

## Enums

| Enum             | Values                                                                          |
| ---------------- | ------------------------------------------------------------------------------- |
| `auth_context`   | `super_admin`, `platform_staff`, `merchant_owner`, `merchant_staff`, `customer` |
| `account_status` | `pending_verification`, `active`, `disabled`                                    |
| `store_status`   | `active`, `suspended`, `closed`                                                 |
| `role_scope`     | `platform`, `store`                                                             |
| `plan_interval`  | `monthly`, `yearly`                                                             |
| `product_status` | `draft`, `active`, `archived`                                                   |
| `domain_type`    | `subdomain`, `custom`                                                           |
