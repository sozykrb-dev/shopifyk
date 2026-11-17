# ADR 0003 · Multi-tenancy and Row-Level Security

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

Tenant isolation is the one bug this platform cannot survive. A leaked product
is bad press; a leaked order is a breach. The usual defence — "remember to add
`WHERE store_id = ?`" — fails the first time someone forgets, and it fails
silently.

The options:

1. **Schema per tenant.** Strong isolation, but 10,000 schemas make migrations
   slow and cross-tenant platform queries painful.
2. **Database per tenant.** Strongest isolation, highest operational cost, and
   platform-wide reporting becomes a federation problem.
3. **Shared schema with `store_id` + Row-Level Security.** One migration to run,
   isolation enforced by PostgreSQL itself, and platform queries still possible
   through a separate role.

## Decision

**Shared schema, `store_id` on every tenant table, and RLS enforced by the
database** — with a second, independent layer in the application.

### Layer 0 — the roles

| Role                | Login | Owns                                               |
| ------------------- | ----- | -------------------------------------------------- |
| `velnorix`          | yes   | nothing; `NOINHERIT`, `NOBYPASSRLS`, `NOSUPERUSER` |
| `velnorix_app`      | no    | nothing; used inside tenant transactions           |
| `velnorix_platform` | no    | nothing; used for platform tables                  |

`NOINHERIT` on `velnorix` is the quiet hero: its privileges are inactive until
code explicitly runs `SET LOCAL ROLE …`, so a query that forgets has **no**
privileges rather than all of them.

### Layer 1 — the application

`packages/db/src/tenant-context.ts` is the only supported way to get a handle:

- `withTenant(storeId, fn)` → `SET LOCAL ROLE velnorix_app` +
  `set_config('app.current_store_id', storeId, true)`
- `withPlatform(fn)` → platform role, tenant context cleared
- `withPlatformTenant(storeId, fn)` → platform role inside a tenant scope, for
  audited platform actions such as impersonation

The tenant id also lives in an `AsyncLocalStorage`, and repositories call
`requireTenantId()` and add their **own** `WHERE store_id = …`. Everything is
`SET LOCAL`, so a pooled connection cannot leak context to the next request.

### Layer 2 — the database

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;

CREATE POLICY products_tenant_isolation ON products
  USING (store_id = app.current_store_id());
```

`FORCE` matters: without it the table owner bypasses its own policies.
`app.current_store_id()` only returns a value when the setting matches a UUID,
so a malformed tenant id yields no rows rather than an error, and it is set via
`set_config(..., true)` — a parameterised `SET LOCAL` — so a malicious store id
cannot inject SQL.

### Money, ids, and the audit trail

- Money is `integer` minor units + ISO-4217 code (see ADR 0006).
- Tenant indexes always lead with `store_id`.
- `audit_logs` is tenant-aware (`store_id` nullable, for platform actions) and
  append-only: no update or delete privilege is granted.

## Consequences

- **Two URLs, two jobs.** `DATABASE_URL` (app, restricted) and
  `DATABASE_MIGRATION_URL` (owner, migrations only). Pointing the app at the
  migration URL would silently disable isolation; the migration script
  re-syncs the app role's password so the two never drift operationally.
- **Every new tenant table must enable RLS in the same migration that creates
  it.** This is a review checklist item, and `packages/db/tests/isolation.test.ts`
  asserts cross-tenant reads return nothing.
- Platform-wide features (search across stores, aggregate reporting) must go
  through `withPlatform` or a deliberately designed platform role; that is a
  feature, not an accident.
- RLS has a cost: the planner sees a function call in the predicate. It is
  `STABLE`, and `store_id` is indexed, so plans stay reasonable.
