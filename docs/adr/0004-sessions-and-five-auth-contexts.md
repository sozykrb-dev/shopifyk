# ADR 0004 · Sessions and the five authentication contexts

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

Five kinds of people sign in, and they are not the same person with different
flags:

| Context          | Signs in on                  | Sees                                            |
| ---------------- | ---------------------------- | ----------------------------------------------- |
| `super_admin`    | `admin.velnorix.com`         | Everything                                      |
| `platform_staff` | `admin.velnorix.com`         | What their permissions allow (support, finance) |
| `merchant_owner` | `{store}.velnorix.com/admin` | Their store                                     |
| `merchant_staff` | `{store}.velnorix.com/admin` | Their store, limited                            |
| `customer`       | `{store}.velnorix.com`       | Their own orders                                |

A customer who can reach a merchant route, or a merchant who can replay their
session against the platform console, is a critical vulnerability. And on a
platform where the email address tells you which merchant someone works for,
account enumeration is a real attack.

## Decision

### Sessions are rows, not tokens

- The cookie holds an opaque 256-bit random token; **only its SHA-256 is
  stored**, so a database leak does not mint sessions.
- Every request re-reads the session row. Revoking a session (sign out, suspend
  a user, "sign out everywhere") takes effect on the next request instead of at
  the end of a token's lifetime.
- Two expiries: a sliding idle TTL (`SESSION_IDLE_TTL_SECONDS`) and a hard
  absolute TTL (`SESSION_ABSOLUTE_TTL_SECONDS`).

Rejected: JWTs. They cannot be revoked, which is disqualifying for a platform
that must be able to lock a merchant out immediately.

### Five contexts, five cookies, enforced on both sides

- `context` is a column on `users` **and** on `sessions`.
- One cookie name per context (`SESSION_COOKIES`), so a browser holding a
  merchant session cannot even _present_ it to a platform route.
- The mapping host → context is one pure function
  (`apps/admin/src/lib/auth-context.ts`) and the check is one pure function
  (`sessionAllowedOnHost`). Both are unit tested: a `platform_staff` session is
  admitted to the console, a `customer` session is admitted nowhere in the
  admin, and a merchant session is admitted only on the store it was minted
  for (`matchesStore`).
- A merchant session presented to another store's admin is rejected even
  though the cookie name matches.

### Credentials

- **Argon2id** (`@node-rs/argon2`) — never a hand-rolled hash, never SHA for
  passwords.
- Password policy is configurable (`PASSWORD_MIN_LENGTH`, default 12) and
  checked on both set and change.
- **TOTP** (`otpauth`, RFC 6238) as the second factor, with the seed
  **encrypted at rest** with `TOTP_ENCRYPTION_KEY`. Super admins must enrol.
  A session that has not completed MFA exists but grants no access:
  `mfaCompletedAt IS NULL` means `requirePrincipal()` redirects to `/mfa`.
- Recovery codes are generated once, hashed, and single-use.
- Only a token hash is stored for email verification and password reset, and
  consuming one is a single atomic operation.

### Every failure looks identical

Wrong password, unknown account, disabled account, locked account and unverified
email all return the same message, and the code path hashes a dummy password
when the account does not exist so the **response time matches too**. Failed
attempts are counted, the account locks after `LOGIN_MAX_ATTEMPTS` for
`LOGIN_LOCKOUT_SECONDS`, and the limiter also throttles by IP.

## Consequences

- A database round-trip per request. Acceptable: correctness and instant
  revocation are worth far more than a millisecond.
- Sessions are pinned to a store, so a merchant who owns two stores needs two
  sessions (two cookies). That is deliberate — it keeps "which store am I
  acting on" unambiguous.
- Every security-relevant action (sign-in, failed sign-in, sign-out, MFA
  enrolment) writes an `audit_logs` row.
