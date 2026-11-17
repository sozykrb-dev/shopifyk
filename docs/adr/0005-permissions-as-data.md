# ADR 0005 · Permissions as data

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

Role checks written as code (`if (user.role === 'owner')`) cannot be changed
without a deploy, cannot be customised per store, and end up scattered across
route handlers where nobody can audit them. Merchants on a platform like this
inevitably ask for "someone who can only handle refunds" — and that request
should be a form, not a release.

## Decision

**Permissions are rows, not code.**

```
permissions (key PK, group, description_en, description_ar)
roles       (id, key, scope ∈ platform|store, store_id NULL for system roles, …)
role_permissions (role_id, permission_key)
store_memberships (store_id, user_id, role_id)   -- store scope
user_platform_roles (user_id, role_id)           -- platform scope
```

- A permission key is namespaced: `platform:tenants.suspend`,
  `store:products.write`, `platform:audit.read`.
- System roles ship in migration `0002_reference_data.sql` with `is_system`
  set, so seed data and production share one definition.
- A store can define its **own** roles (`store_id` set, `scope = 'store'`),
  which is how "refunds only" becomes data entry rather than a deploy.
- The permission catalogue is bilingual, because the permission picker in the
  admin UI is a user-facing surface and this platform is Arabic-first.

### One way to ask

`packages/auth/src/rbac` exposes:

```ts
can(principal, PERMISSION.STORE_PRODUCTS_WRITE)  // boolean
canAll(principal, [...]) / canAny(principal, [...])
assertCan(principal, permission)     // throws ForbiddenError
assertContext(principal, ['merchant_owner'])
assertStoreAccess(principal, storeId)
```

The `Principal` (user id, context, store id, session id, permission set, MFA
state) is loaded **server-side on every request** from the database — never
taken from the client, never cached across a permission change. `can()` is pure
and takes the principal, so it is trivially unit-testable.

Server actions and route handlers call `assertCan` before doing anything; the
UI hides what the user cannot do, but hiding is a convenience, not a control.
Every check is re-evaluated on the server.

## Consequences

- Permission changes take effect on the next request — no redeploy, no cache
  invalidation logic.
- `PERMISSION.*` is a typed constant map over the rows, so a typo is a compile
  error and a permission removed from the database is a type error.
- Adding a permission means a migration (a row) plus a constant. Both are
  reviewable in one diff.
- The principal's permission set is loaded per request; if that ever becomes
  hot, the fix is a short-TTL cache keyed by `(user, store)`, not a client-side
  permission blob.
