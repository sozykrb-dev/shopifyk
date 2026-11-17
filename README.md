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
