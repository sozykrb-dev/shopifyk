# Velnorix

Multi-tenant e-commerce platform (a Shopify-style SaaS) built for the Egyptian
market: Arabic-first RTL interface, English second, EGP as the base currency,
Paymob / Fawry / cash-on-delivery for checkout and Stripe Billing for the
merchant's subscription to the platform.

This repository is **Phase 0** of the build: the foundation every later phase
sits on — monorepo, database and migrations, authentication, RBAC, tenant
isolation, observability, design system and CI.

- **Platform name:** Velnorix
- **Market:** Egypt (EGP) — Arabic (RTL) first, English second
- **Customer → merchant payments:** Paymob, Fawry, cash on delivery, manual bank transfer
- **Merchant → platform billing:** Stripe Billing, with a manual invoice fallback
- **Phase status:** Phase 0 complete (see [docs/adr](docs/adr))

---

## Quick start

One command brings up a clean clone:

```bash
pnpm bootstrap
```

`scripts/bootstrap.mjs` will:

1. `pnpm install`
2. create `.env` from `.env.example` with a freshly generated 32-byte encryption key
3. start PostgreSQL — `docker compose up -d` when Docker is available, otherwise
   the embedded PostgreSQL managed by `scripts/pg.mjs` (port 5433, data in `.pgdata`)
4. apply the migrations (`pnpm db:migrate`)
5. seed the demo data (`pnpm db:seed`) and print the demo accounts

Then:

```bash
pnpm dev          # admin console on :3000, storefront on :3001
```

### Manual setup

```bash
pnpm install
cp .env.example .env          # then set TOTP_ENCRYPTION_KEY to a 32-byte secret
pnpm db:start                 # embedded PostgreSQL (Docker users: docker compose up -d)
pnpm db:migrate
pnpm db:seed
pnpm dev
```

> Every value in `.env.example` is safe for local development only. Production
> values come from a secret manager, never from Git.

---

## Opening each app (host-based tenants)

Tenants are resolved from the `Host` header, never from a path, so a storefront,
a store's admin and the platform console can never be confused with each other:

| Host                                | Serves                                         |
| ----------------------------------- | ---------------------------------------------- |
| `admin.velnorix.test:3000`          | Platform console (super admin, platform staff) |
| `cairo-sneakers.velnorix.test:3001` | That store's **storefront**                    |
| `cairo-sneakers.velnorix.test:3000` | That store's **admin**                         |
| `www.my-brand.com`                  | A verified custom domain for one store         |

`velnorix.test` is the default `APP_BASE_DOMAIN`. Locally, add the hostnames to
`/etc/hosts`, or use the development override, which is enabled by
`ALLOW_DEV_TENANT_OVERRIDE=true` and ignored in production:

```
http://localhost:3001/?__tenant=cairo-sneakers     # storefront for one store
http://localhost:3000/?__tenant=cairo-sneakers     # that store's admin
```

The override is remembered in a cookie and stripped from the URL on the first
redirect, so links and analytics stay clean.

If the host matches no store at all (a local or preview URL), the storefront
opens `DEV_FALLBACK_TENANT` instead of a dead end — also development only,
never in production, and never in place of a real host that resolved.

---

## What the storefront does

The storefront is the customer-facing app on port 3001. Pages:

| Route                | What it is                                       |
| -------------------- | ------------------------------------------------ |
| `/`                  | Product grid (published products only)           |
| `/products/[handle]` | Product page: gallery, variants, add to cart     |
| `/cart`              | Lines, quantity update, subtotal                 |
| `/account/register`  | Create a customer account for **this** store     |
| `/account/login`     | Sign in as a customer                            |
| `/account/verify`    | Confirm an email address with the one-time token |
| `/account`           | The signed-in customer's home                    |

Three rules the storefront keeps:

- **The store comes from the `Host` header, never from the client.** Every
  Server Action re-resolves it with `requireStorefront()`; a `storeId` posted by
  a browser is ignored.
- **Prices come from the database, never from the form.** The action re-reads
  the product (or variant) inside `withTenant(store.id)` before writing a line.
- **Registration never reveals whether an address exists.** "New customer" and
  "already registered" return the same screen; the verification token is only
  issued for a brand-new account. In development the token is shown on screen,
  since there is no mail server — in production it is emailed and never leaves
  the server.

A guest cart is keyed by a random cookie token; only its SHA-256 is stored. On
sign-in the guest cart is **claimed** by the customer rather than merged, so a
half-filled basket is never silently dropped.

### Pricing

### Inventory

Stock is taken **when the order is placed**, not when the item is added to the
cart — inside the order's own transaction, with a `WHERE inventory_quantity >=
qty` guard. Two customers buying the last unit at the same instant cannot both
succeed, because the database decides, not a read-then-write in application
code. If any line would oversell, the whole order rolls back: no order, no
items, no stock taken, and the cart is left spendable.

Two places hold stock, and both are real: a **variant** when a product comes in
sizes or colours, and the **product** itself when it does not. A reservation
that only understood variants would be a silent no-op for every store that
sells whole products — which is most of them.

The cart is capped by the stock that backs it, so a customer is not sent to
checkout with 99 of something the store has three of. A sold-out product
disables its own add-to-cart button rather than failing at the till.

### Store settings

The storefront has always rendered from `store_settings` — theme, colour,
locale and currency are read on every page. What was missing was the other
half: somewhere for the merchant to set them. `/settings` in the store console
is that half, gated on `store:settings.write`.

The name and defaults are written to `stores`, the appearance to
`store_settings`, both inside one transaction: a half-applied save would leave
a store whose name changed but whose language did not, which a merchant
reports as "the site is broken".

The colour is validated as a six-digit hex, and the logo as an `https://` or
root-relative URL. Neither is cosmetic — both are injected into the rendered
page, so an unvalidated value is stored XSS dressed up as branding.

### Customer accounts

Registration, email verification, login, and — new — a password reset loop
that closes cleanly.

`/account/forgot` asks for an email and answers with the _same_ sentence
whether or not the address exists. Telling a customer "no such account" turns
the form into a free membership oracle for anyone holding a list of email
addresses, and that is not a trade worth making for a friendlier message.

`/account/reset` takes the emailed token and sets a new password. The token is
read and consumed by a single `UPDATE … WHERE consumed_at IS NULL RETURNING`,
so the link works exactly once: replaying it cannot produce a second winner,
and a token stolen from an old email stops working the moment a new one is
requested. In development the token is shown on screen, because there is no
mail server to deliver it.

### Staff and roles

Roles and their permissions were defined in migration `0002` and have been
enforced by the RBAC engine since Phase 1 — what was missing was any way for a
merchant to _use_ them. `/staff` in the store console is that missing half.

Without it, a store owner's only option is to share their own password. That is
how most small stores actually work, and it is why an audit trail is useless at
most of them.

Three rules are enforced in the action, not the page, because the page is only
a suggestion:

- **Nobody edits their own membership.** Otherwise a staff member who holds
  `store:staff.write` promotes themselves to owner, and the audit log records a
  decision nobody made.
- **The last owner cannot be demoted or disabled.** A store with no owner has
  nobody who can add one back; the recovery is a platform operator with SQL
  access, which is an incident rather than a workflow.
- **Only store-scoped roles are assignable.** Granting `platform_owner` from a
  merchant console is how a merchant becomes an administrator of everyone
  else's shop.

A revoked account is disabled, never deleted. Deleting the membership would
leave orders and audit entries pointing at someone who appears never to have
worked there, which is worse than a locked door.

### Billing, for both sides of it

`/billing` means two different things to two different people, and it answers
both from the same route.

To the platform it is _who owes us what_: MRR across every store, the plan
catalogue, outstanding invoices. To a merchant it is _what do I owe_: my plan,
my renewal date, my invoices. The audience is chosen by context — a merchant
asking for `/billing` is asking about themselves, and showing them the
platform's revenue would be a data leak wearing a nav item.

The merchant half was missing for a while, which in practice means a shop
owner learns what they owe when a charge appears on their card. The permission
(`store:billing.read`) had been seeded since Phase 2; nothing read it.

Worth knowing: `startSubscription` takes the trial length as an argument and
does **not** read it off the plan. Callers pass `plan.trialDays`, as the seed
does. Forgetting to is a silent downgrade — the store skips its trial and is
billed from day one, and nothing errors.

### Catalogue

`/products` is the store's catalogue: server-rendered, with search and
cursor-based paging. Search and paging live in the URL, so a filtered view is a
link a customer can share. Paging is a cursor rather than an OFFSET, because
page 900 of an OFFSET query makes Postgres walk 36,000 rows to throw them away.

Tax, shipping and coupons are **data, not code**. A merchant changes what they
charge on the **التسعير** page of their store console; the engine that applies
the rules (`packages/pricing`) is a pure function over those rows, and is never
redeployed to change a price.

Four rules are enforced in the engine and pinned by tests:

1. **The server prices the order.** The browser posts an address and a coupon
   code — never a total. A total that arrives in a form field is a total a
   customer can edit.
2. **The receipt always adds up.** Discounts and tax are _allocated_ across
   lines with the largest-remainder method, so the lines sum to the order total
   down to the last piastre. Rounding each line independently is how a receipt
   stops adding up.
3. **Free shipping is judged before the discount.** Otherwise a coupon could
   push an order under the threshold and cost the customer more than the coupon
   saved.
4. **Tax-inclusive is the default**, because Egypt displays it that way: when a
   shelf price already contains VAT the tax is _extracted_ from it, not added
   on top (`extractTax` in `core/money`).

A store that has configured nothing charges **no tax and no shipping**. The
default rate is zero, never an invented one — ADR 0007 deferred tax as a
business decision, and the absence of a decision must not become a 14% charge
the merchant never agreed to.

Usage caps are **counted from redemption rows**, not from a counter on the
coupon, so a limit can never drift from the redemptions it is limiting. A
coupon that does not apply stops the order with an Arabic reason rather than
silently charging full price.

### Payments

One gateway interface, several adapters: cash on delivery, manual bank
transfer, Paymob (cards and wallets) and Fawry (pay at a kiosk). Checkout never
branches on provider — it asks the registry which methods are configured and
renders them.

Three rules the webhook handler keeps, in this order:

1. **Verify the signature** before reading the body. An unverified webhook is
   an unauthenticated API for marking orders paid.
2. **Never trust the amount.** The money is read from _our_ intent row; a
   webhook that disagrees is recorded, rejected with a 409, and never applied.
3. **Be idempotent.** Each provider's event id is claimed under a unique index,
   so a replay is reported as a duplicate instead of paying twice.

Gateways are **sandbox by default**: without credentials in the environment a
provider is simply not offered, and nothing can reach a live gateway without
live keys (`PAYMOB_LIVE` / `FAWRY_LIVE`). See `.env.example`.

An order is a **snapshot**, not a live view: the customer's name, address and
every line's price are copied at checkout. Renaming a product or changing its
price afterwards must not re-write what somebody already agreed to pay. Two
guards make checkout safe to re-submit: a unique index so one cart can only
ever become one order, and a per-store sequence so each store numbers its own
orders from 1001.

---

## Demo accounts

`pnpm db:seed` prints this table; the password is `SEED_PASSWORD` from `.env`
(`Sahara!Dune#2026` by default). The super admin needs a 6-digit TOTP code,
which changes every 30 seconds — print the live one with:

```bash
pnpm totp
```

It also prints the `otpauth://` URI for enrolling the seed
(`SEED_TOTP_SECRET`, `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` by default) in an
authenticator app once, after which you never need the command again.

| Email                         | Context          | Where                          | Second factor   |
| ----------------------------- | ---------------- | ------------------------------ | --------------- |
| `owner@velnorix.test`         | `super_admin`    | `admin.velnorix.test`          | TOTP (enrolled) |
| `support@velnorix.test`       | `platform_staff` | `admin.velnorix.test`          | –               |
| `finance@velnorix.test`       | `platform_staff` | `admin.velnorix.test`          | –               |
| `owner@cairo-sneakers.test`   | `merchant_owner` | `cairo-sneakers.velnorix.test` | –               |
| `manager@cairo-sneakers.test` | `merchant_staff` | `cairo-sneakers.velnorix.test` | –               |
| `owner@zad-naturals.test`     | `merchant_owner` | `zad-naturals.velnorix.test`   | –               |
| `ahmed@example.com`           | `customer`       | `cairo-sneakers.velnorix.test` | –               |
| `nour@example.com`            | `customer`       | `zad-naturals.velnorix.test`   | –               |

The same email exists as two customer accounts — one per store — which is the
point of per-store customers: they are different accounts that happen to share
an address.

---

## Repository layout

```
apps/
  admin/        Platform console + per-store admin (Next.js App Router, port 3000)
  storefront/   Per-tenant storefront (Next.js App Router, port 3001)
packages/
  config/       Shared tsconfig presets and ESLint flat configs
  core/         Pure, dependency-free building blocks (env, money, hosts, ids, …)
  db/           Drizzle schema, migrations, repositories, tenant + RLS context
  auth/         Passwords, TOTP, sessions, RBAC, tokens, rate limiting
  design-system/ Design tokens + base components (RTL/LTR, light/dark)
  test-utils/   Real PostgreSQL instance for integration tests
scripts/        pg.mjs (embedded Postgres), migrate, seed, reset, bootstrap
docs/           Schema reference and architecture decision records
```

### Why the packages are split this way

`packages/core` is the only package with no runtime dependencies, so the edge
middleware can import it (`@velnorix/core/hosts`). `packages/db` owns every
query and the tenant context; no application code opens a connection of its own.
`packages/auth` owns credentials, sessions and permissions and never trusts a
caller-supplied store id.

---

## Common commands

| Command           | What it does                                             |
| ----------------- | -------------------------------------------------------- |
| `pnpm bootstrap`  | One-command setup on a clean clone                       |
| `pnpm dev`        | Both apps in watch mode                                  |
| `pnpm build`      | Production build of both apps                            |
| `pnpm lint`       | ESLint (type-aware, Next + React + hooks rules)          |
| `pnpm typecheck`  | `tsc --noEmit` across every package                      |
| `pnpm test`       | Unit + integration tests (149 tests, real PostgreSQL)    |
| `pnpm test:e2e`   | Playwright end-to-end suite (`apps/admin`)               |
| `pnpm ci`         | lint + typecheck + test + build, in that order           |
| `pnpm db:start`   | Start the embedded PostgreSQL (port 5433)                |
| `pnpm db:stop`    | Stop it                                                  |
| `pnpm db:migrate` | Apply migrations                                         |
| `pnpm db:reset`   | Drop and recreate (refuses production without `--force`) |
| `pnpm db:seed`    | Idempotent demo data                                     |
| `pnpm format`     | Prettier                                                 |

End-to-end tests need a browser once:

```bash
pnpm exec playwright install chromium
```

---

## Architecture

### Tenancy

One database, one schema, `store_id` on every tenant table, and
**Row-Level Security** enforced by PostgreSQL itself — not by a convention in
the application. The application connects as `velnorix`, a role that owns
nothing and has `NOBYPASSRLS`; tenant queries run inside
`SET LOCAL ROLE velnorix_app` + `SET LOCAL app.current_store_id`. A query that
forgets its `WHERE store_id = …` returns nothing instead of leaking another
store's data. See [docs/adr/0003-multi-tenancy-and-rls.md](docs/adr/0003-multi-tenancy-and-rls.md).

### Authentication

Five separate **authentication contexts** — `super_admin`, `platform_staff`,
`merchant_owner`, `merchant_staff`, `customer` — each with its own cookie name,
its own session rows and its own host. Sessions are server-side rows, never
JWTs, so revoking one (suspend a user, sign out everywhere) takes effect on the
next request. Passwords are hashed with Argon2id; super admins must enrol TOTP;
failed logins are rate limited and lock the account, and every failure returns
one generic message so the form cannot be used to enumerate accounts.

### Permissions

Permissions are **data**, not code: rows in `permissions`, grouped by `roles`,
joined to users through `store_memberships` (store scope) or
`user_platform_roles` (platform scope). `can(principal, PERMISSION.X)` is the
only way an action is authorised, and it is always evaluated on the server.
See [docs/adr/0005-permissions-as-data.md](docs/adr/0005-permissions-as-data.md).

### Money

Money is `integer` minor units plus an ISO-4217 code — never a float. All
arithmetic goes through `packages/core/money`, which refuses to add amounts in
different currencies. EGP is the default for new stores.

### Observability

Structured JSON logs through pino (redacting secrets), error reporting through
Sentry that no-ops without `SENTRY_DSN`, and an append-only `audit_logs` table
for every security-relevant action.

---

## Documentation

- [docs/SCHEMA.md](docs/SCHEMA.md) — tables, roles and RLS policies
- [docs/adr](docs/adr) — architecture decision records:
  1. [Monorepo structure and tooling](docs/adr/0001-monorepo-structure-and-tooling.md)
  2. [Host-based tenant resolution](docs/adr/0002-host-based-tenant-resolution.md)
  3. [Multi-tenancy and Row-Level Security](docs/adr/0003-multi-tenancy-and-rls.md)
  4. [Sessions and the five authentication contexts](docs/adr/0004-sessions-and-five-auth-contexts.md)
  5. [Permissions as data](docs/adr/0005-permissions-as-data.md)
  6. [Money, currency and Arabic RTL](docs/adr/0006-money-currency-and-arabic-rtl.md)
  7. [Payments and subscription billing](docs/adr/0007-payments-and-subscription-billing.md)
  8. [Observability and error reporting](docs/adr/0008-observability-and-error-reporting.md)
  9. [Testing and CI](docs/adr/0009-testing-and-ci.md)

---

## Continuous integration

`.github/workflows/ci.yml` runs two jobs on every push and pull request:

- **quality** — `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`
  against a `postgres:18` service container.
- **e2e** — migrations + seed, then the Playwright suite against the built admin
  console, uploading the report as an artifact.

Both jobs run `pnpm install --frozen-lockfile`, so `pnpm-lock.yaml` must be
committed whenever dependencies change.

---

## Requirements

- Node.js ≥ 22
- pnpm ≥ 10 (`corepack enable` will install the pinned version)
- PostgreSQL 18 — either Docker Compose or the embedded server in
  `scripts/pg.mjs` (no Docker required)

## Licence

Proprietary. All rights reserved.
