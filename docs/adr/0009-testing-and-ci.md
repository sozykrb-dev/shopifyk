# ADR 0009 · Testing and CI

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

The parts of this platform that must not break are exactly the parts that are
hardest to test with mocks: Row-Level Security, session semantics, money
arithmetic, permission evaluation. A mocked database proves nothing about an RLS
policy, and a test suite that only runs in CI-with-a-real-Postgres is a suite
nobody runs locally.

## Decision

### Real PostgreSQL, started automatically

`packages/test-utils` boots a throwaway PostgreSQL **per test file** on its own
port, applies the real migrations, and hands back a connection string. No
Docker requirement, no shared state between files, no `.sql` fixtures that can
drift from the migrations. `packages/db` and `packages/auth` tests therefore
exercise the **actual** schema, roles and RLS policies.

Consequences we accepted: the suite is a few seconds slower than it would be
against a mock, and `test` is uncached in Turborepo so it always runs.

### Layers

| Layer       | Where                           | What it covers                                                                                       |
| ----------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unit        | `packages/core`                 | Pure functions: money, pagination, slugs, host classification, rate limiting                         |
| Integration | `packages/db`, `packages/auth`  | Real SQL: tenant isolation, repositories, sessions, TOTP, RBAC, authentication                       |
| App unit    | `apps/admin`, `apps/storefront` | App-level pure logic: host → context mapping, theming                                                |
| End-to-end  | `apps/admin/e2e`                | Playwright: sign in as a merchant, wrong password, super-admin 2FA, sign-out invalidates the session |

Count at the end of Phase 0: **149 tests** (66 core, 36 auth, 29 db, 11 admin,
7 storefront) plus the Playwright suite.

### What is tested because it is dangerous

- **Cross-tenant reads** — `packages/db/tests/isolation.test.ts` tries to read
  another tenant's rows with and without a `WHERE` clause, and asserts nothing
  comes back. If someone adds a tenant table and forgets RLS, this is the test
  that fails.
- **Session/context separation** — a merchant session presented to the platform
  console, a super-admin session presented to a store, a customer session in the
  admin: all rejected.
- **Generic failures** — wrong password and unknown account produce identical
  errors _and_ comparable timings.
- **Tenant override safety** — `?__tenant=` is ignored in production and an
  invalid slug never becomes a tenant.

### Continuous integration

`.github/workflows/ci.yml`, two jobs:

- **quality** — `pnpm install --frozen-lockfile`, then `lint`, `typecheck`,
  `test` and `build` against a `postgres:18` service container.
- **e2e** — migrate + seed, start the admin console, run Playwright on Chromium,
  and upload `playwright-report` as an artifact.

CI uses port 5432 (the GitHub service container) while local development uses
5433 (the embedded server in `scripts/pg.mjs`), which is why both URLs are
environment variables rather than constants.

Lint is type-aware (`@typescript-eslint` with `projectService`), so ESLint and
`tsc` agree, and `no-floating-promises` is an error — an unawaited promise is a
class of bug that only shows up in production.

## Consequences

- `pnpm test` needs to be able to start a PostgreSQL binary. That is why
  `embedded-postgres` is a root devDependency and `pnpm bootstrap` does not
  require Docker.
- End-to-end tests need `pnpm exec playwright install chromium` once, locally;
  CI installs it in the job. The storefront intentionally has **no** e2e suite
  yet — its tenant routing is covered by the host-classification unit tests and
  by the storefront's own app tests.
- New tenant tables must come with an isolation test. This is the one rule that
  is enforced by review, not by tooling.
