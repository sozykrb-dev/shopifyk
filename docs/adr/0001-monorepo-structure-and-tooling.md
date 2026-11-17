# ADR 0001 · Monorepo structure and tooling

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

The platform has two Next.js applications (the admin console and the
storefront) and several pieces of logic that **must** be identical in both:

- host → tenant resolution (a disagreement here is a data leak)
- money arithmetic
- password hashing, TOTP, sessions, permission checks
- design tokens and base components

Duplicating any of those in two apps guarantees they drift. Copying files
around is worse than sharing them.

## Decision

A **pnpm workspace** (`apps/*`, `packages/*`) orchestrated by **Turborepo**:

```
apps/admin          platform console + per-store admin
apps/storefront     per-tenant storefront
packages/config     tsconfig presets, ESLint flat configs
packages/core       pure, dependency-free primitives
packages/db         schema, migrations, repositories, tenant/RLS context
packages/auth       passwords, TOTP, sessions, RBAC, tokens
packages/design-system  tokens + base components
packages/test-utils     throwaway PostgreSQL for tests
```

Notable choices inside that:

- **Packages ship TypeScript source, not build output.** The `exports` map
  points at `src/*.ts` and the apps transpile them (`transpilePackages`). No
  watch-on-watch build step, no stale `dist`, and stack traces point at real
  source lines. The cost — apps must resolve `.js` specifiers to `.ts`/`.tsx` —
  is paid once in `next.config.ts` (`resolve.extensionAlias`).
- **`@velnorix/core` has zero runtime dependencies** so the edge middleware can
  import from it. It is also exported by subpath (`@velnorix/core/hosts`,
  `/money`, …) so importing the host helpers never drags `node:crypto` into the
  edge bundle.
- **`packages/db` owns every query.** No application code opens a connection.
- **One ESLint config, applied everywhere** (`@velnorix/config/eslint/{base,next}`)
  with type-aware rules: `no-floating-promises` is an error, because an unawaited
  promise is how a failed payment silently becomes a successful one.
- **Prettier** with a checked-in config; `pnpm format:check` is part of CI.

## Consequences

- `pnpm install` at the root is the only install step.
- Adding a shared package is cheap, which makes it tempting to share things
  that should not be shared. The rule: share _rules_ (money, tenancy, auth),
  not _features_.
- Because packages are consumed as source, a type error in `packages/core`
  fails `pnpm typecheck` at the root — which is what we want.
- Turborepo caches lint/typecheck/test/build; `test` is intentionally
  uncached so it always runs against a fresh database.
