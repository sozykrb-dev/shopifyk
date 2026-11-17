# ADR 0002 · Host-based tenant resolution

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

A tenant must be identifiable before anything else can happen: which store's
products do we show, whose session cookie do we trust, whose data may this
request touch. The alternatives are:

1. a path prefix (`/s/cairo-sneakers/products`),
2. a query parameter or header the client sets,
3. the **Host header** (`cairo-sneakers.velnorix.com`).

Options 1 and 2 put the tenant in the URL, which leaks it into analytics,
referrers, shared links and — worst — makes it user-controlled state that a
client can change while a session cookie stays valid.

## Decision

The Host header is the **only** source of tenant identity, classified once in
edge middleware and forwarded to the server as `x-velnorix-*` request headers:

| Host                  | Kind       | Meaning                                                      |
| --------------------- | ---------- | ------------------------------------------------------------ |
| `admin.velnorix.com`  | `platform` | Platform console                                             |
| `{slug}.velnorix.com` | `store`    | That store (storefront or store admin, depending on the app) |
| `www.my-brand.com`    | `store`    | A verified custom domain, resolved through `store_domains`   |
| `velnorix.com`        | `unknown`  | Nothing; the app renders "no store here"                     |

Rules that make this safe:

- **One pure function decides.** `classifyTenantHost()` lives in
  `packages/core/src/hosts.ts`, has no dependencies, and is the only place the
  rules exist. Both apps' middleware call it; 15 unit tests pin its behaviour.
- **The middleware never touches the database.** It runs on the edge, so it can
  only classify the host. The store row is loaded on the server through
  `withPlatform`, and all tenant data is read inside `withTenant(store.id)`.
- **The Host header is normalised before use** (trimmed, lower-cased, port
  stripped) and treated as untrusted input throughout.
- **`admin` is never a store slug.** The console host is checked first, so a
  store cannot be called `admin`.
- **A dev override exists and is off in production.** `?__tenant=<slug>` is
  accepted only when `NODE_ENV !== 'production'` **and**
  `ALLOW_DEV_TENANT_OVERRIDE === 'true'`; the value is validated as a slug and
  an invalid one is ignored rather than trusted. It is remembered in a cookie
  and stripped from the URL on first response.
- **`localhost` is never a store.** `localhost`, `127.x` and `::1` fall back to
  the platform console so `pnpm dev` works with no configuration;
  `foo.localhost` is a dev subdomain for the `foo` store.

## Consequences

- Local development needs either `/etc/hosts` entries or the `?__tenant=`
  override. Both are documented in the README.
- Custom domains are a lookup (`store_domains.host`), not a convention, so
  verification status can be enforced later without changing routing.
- Because the kind is computed on the edge and the store is loaded on the
  server, an unknown/suspended store is handled explicitly rather than 500-ing.
- Preview deployments (this repository's own preview environment included) get
  the override, which is why it exists at all.
