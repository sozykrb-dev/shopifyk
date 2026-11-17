# ADR 0008 · Observability and error reporting

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

A multi-tenant platform fails in ways a single-tenant app does not: one store's
bad data takes down a shared worker, a slow query shows up as "the site is slow"
for everyone, and "who did that?" is a question with legal weight. Three things
are needed from day one: structured logs, error reporting, and an audit trail.

## Decision

### Structured logs

`packages/core/src/logger.ts` wraps pino:

- JSON in production (one line per event, greppable and shippable), pretty in
  development.
- `LOG_LEVEL` from the environment, validated at startup with every other
  environment variable — a misconfigured deployment fails fast and loudly
  instead of logging nothing.
- **Redaction is built in**: `password`, `token`, `authorization`, `cookie`,
  `secret`, TOTP seeds and anything that looks like a credential are replaced
  before the line is written. Redaction lives in the logger, not in the call
  sites, because call sites forget.
- Every log line carries the tenant id when a tenant context is active, so
  "which store is this?" is never a separate investigation.

### Errors

- One `AppError` hierarchy in `packages/core/src/errors.ts` with an HTTP status
  and a stable machine-readable code, so handlers can map errors to responses
  without string matching.
- `Result<T, E>` for expected failures (validation, "not found") and thrown
  errors for exceptional ones.
- **Sentry** through `@sentry/nextjs`, initialised in `instrumentation.ts` and
  **no-ops entirely when `SENTRY_DSN` is absent**. Local development, CI and
  tests therefore run with zero Sentry surface.
- `beforeSend` strips cookies and `Authorization` headers, and
  `sendDefaultPii` is **false**. An error report must never be the thing that
  leaks a session token.

### Audit trail

`audit_logs` records actor (user, context), action, target, tenant, IP and user
agent for every security-relevant event: sign-in, failed sign-in, lockout,
sign-out, MFA enrolment and verification, permission changes, and later every
payment and administrative action. It is append-only — the application roles
are not granted `UPDATE` or `DELETE` on it.

### Validation

Every application validates its environment with Zod at startup
(`packages/core/src/env.ts`). A missing or malformed variable throws a
`ConfigurationError` naming the exact variable, instead of producing a `NaN`
timeout or an empty encryption key three layers down.

## Consequences

- Logs are the primary debugging tool in production; there is no step debugger
  there, so structure beats volume.
- Because Sentry is opt-in by DSN, a self-hosted deployment can run the
  platform with no third-party error reporting at all.
- Audit rows are written inside the same transaction as the change they
  describe wherever possible, so a rolled-back action leaves no claim that it
  happened.
