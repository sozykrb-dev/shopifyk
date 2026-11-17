# ADR 0007 · Payments and subscription billing

- **Status:** Accepted (design only — no gateway code exists in Phase 0)
- **Date:** 2026-11-17
- **Phase:** 0

## Context

Two completely different money flows, which must never be modelled as one:

1. **Customer → merchant.** Paymob, Fawry, cash on delivery, and manual bank
   transfer. Amounts in EGP, disputes and refunds handled per gateway.
2. **Merchant → platform.** The subscription: Stripe Billing, with a manual
   invoice fallback for merchants who cannot or will not pay by card.

The build rules for this project are explicit: **gateways stay in sandbox mode
until told otherwise**, and there is no guessing on money.

## Decision

### Recorded now, implemented later

Phase 0 deliberately ships **no** gateway integration. What it ships is the
groundwork the integrations will sit on, so none of these decisions have to be
revisited:

- Money as integer minor units + currency (ADR 0006).
- `plans` with `price_minor`, `currency`, `interval`, `trial_days`,
  `transaction_fee_bps` and a JSONB `limits`.
- `transaction_fee_bps` defaults to **0**: the platform's take is a business
  decision, and encoding a guessed number in the database would be a guess
  about money. The column exists so the decision is a config change.
- An append-only `audit_logs` table, which is where every payment event will be
  recorded.

### Design constraints for the later phases

These are decisions, not intentions:

- **One gateway interface, several adapters.** `createPayment`, `capturePayment`,
  `refundPayment`, `parseWebhook` — per provider (Paymob, Fawry, COD, manual
  transfer). The rest of the system never branches on provider.
- **Every webhook is verified** (signature/HMAC) **and idempotent**: the
  provider's event id is stored uniquely, so a replay cannot double-apply a
  payment.
- **Money is never recomputed from a webhook.** The amount is looked up from our
  own payment intent row; a webhook that disagrees is rejected and alerted on.
- **State machines, not booleans.** `pending → authorized → captured`,
  `→ refunded / partially_refunded / failed`, with every transition written to
  the audit log.
- **COD and manual transfer are first-class adapters**, not special cases in
  checkout: they simply have no external confirmation step.
- **Sandbox by default.** Credentials come from the environment; there is no
  code path that can talk to a live gateway without live credentials, and CI
  never has them.
- **Subscriptions (Stripe Billing) are a separate bounded context** from
  checkout: different tables (`subscriptions`, `invoices`), different webhooks,
  and the manual-invoice fallback is modelled as an invoice with an off-platform
  payment reference rather than as an exception.

### Deliberately deferred

- Which plan prices to charge (`plans.price_minor` is seeded at 0).
- Whether the platform takes a transaction fee (`transaction_fee_bps = 0`).
- Payout timing to merchants.
- Tax handling.

## Consequences

- Phase 0 can be reviewed without a single payment credential.
- Adding a gateway later is an adapter plus a migration for its columns — no
  change to checkout, orders, or the admin UI's shape.
- Because pricing is zeroed rather than guessed, nothing in Phase 0's seed data
  can be mistaken for a real price.
