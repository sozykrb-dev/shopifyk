# ADR 0006 · Money, currency and Arabic RTL

- **Status:** Accepted
- **Date:** 2026-11-17
- **Phase:** 0

## Context

The market is Egypt. Three things follow, and getting any of them wrong later is
expensive:

1. **Money must never be a float.** `0.1 + 0.2` is not `0.3`, and the bug shows
   up as a one-piastre discrepancy on a reconciliation report months later.
2. **The base currency is EGP**, and amounts are formatted for an Arabic, RTL
   reading order.
3. **Arabic is the primary language**, English second; the whole interface must
   mirror, not just translate.

## Decision

### Money

- Stored as `integer` **minor units** (piastres for EGP) plus an ISO-4217
  `currency` code. Never `float`, never `numeric`.
- All arithmetic goes through `packages/core/src/money.ts`:
  `money()`, `fromDecimal()`, `add()`, `subtract()`, `multiply()`, `sum()`,
  `applyRate()`, `allocate()` (lossless splits), `formatMoney()` and
  `compare()`.
- **Adding or comparing amounts in different currencies throws.** Silent
  mixed-currency arithmetic is worse than a crash.
- `allocate()` distributes remainders deterministically (largest-remainder),
  so a discount split across lines always sums back to the total — the classic
  source of one-piastre mismatches.
- 16 unit tests cover rounding, allocation and formatting.

### Localisation

- The document root is `<html lang="ar" dir="rtl">`; LTR is the exception, set
  per store or per session, and the interface flips through **logical CSS
  properties** (`ms-`/`me-`, `ps-`/`pe-`, `start`/`end`) rather than
  `left`/`right`, so nothing has to be duplicated for the other direction.
- The design system ships both directions plus light and dark themes as CSS
  custom properties (`packages/design-system/src/styles/tokens.css`), so a
  store's accent colour overrides one variable (`--primary`) and every derived
  token follows.
- Content columns that are per-language are per-language in the schema
  (`title_ar` / `title_en`), not translations in a JSON blob, because they are
  queried and indexed.
- Fonts are loaded from the CDN at runtime rather than through `next/font`, so
  a build never needs network access.
- Numbers use `font-variant-numeric: tabular-nums` through the `.numeric`
  helper so prices line up in tables, with an RTL rule that keeps Latin digits
  in a sensible reading order.

## Consequences

- Any new monetary field must be two columns (amount + currency) and go through
  `money()`. This is a review checklist item.
- Formatting happens at the edge of the system, in the UI; services pass
  `Money` values around.
- RTL is the default, so a component that looks right in RTL and breaks in LTR
  is the failure mode to watch for; both directions are exercised in the
  design system.
