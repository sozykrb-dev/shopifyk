import { and, desc, eq } from 'drizzle-orm';
import { money, type Money } from '@velnorix/core';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import {
  paymentEvents,
  paymentIntents,
  type NewPaymentEvent,
  type PaymentEvent,
  type PaymentIntent,
} from '../schema.js';

/**
 * Payment intents and webhook events (tenant tables).
 *
 * The two rules from ADR 0007 are enforced here rather than trusted to the
 * caller:
 *
 *   1. **The amount is ours, never the webhook's.** `recordWebhookEvent`
 *      compares the amount the provider reports against the amount on our
 *      intent and refuses to move the payment if they disagree.
 *   2. **Every event is applied at most once.** The insert into
 *      `payment_events` is what claims the event; a replay hits the unique
 *      index and is reported as a duplicate instead of paying twice.
 */

export type CreateIntentInput = {
  orderId: string;
  provider: string;
  amount: Money;
  providerReference?: string | null;
  redirectUrl?: string | null;
  instructions?: string | null;
  status?: string;
};

export async function createPaymentIntent(
  db: Database,
  input: CreateIntentInput,
): Promise<PaymentIntent> {
  const [intent] = await db
    .insert(paymentIntents)
    .values({
      storeId: requireTenantId(),
      orderId: input.orderId,
      provider: input.provider,
      providerReference: input.providerReference ?? null,
      status: input.status ?? 'pending',
      amountMinor: input.amount.amount,
      currency: input.amount.currency,
      redirectUrl: input.redirectUrl ?? null,
      instructions: input.instructions ?? null,
    })
    .returning();
  return intent!;
}

export async function getPaymentIntent(
  db: Database,
  intentId: string,
): Promise<PaymentIntent | null> {
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.storeId, requireTenantId()), eq(paymentIntents.id, intentId)))
    .limit(1);
  return intent ?? null;
}

export async function getPaymentIntentByReference(
  db: Database,
  provider: string,
  providerReference: string,
): Promise<PaymentIntent | null> {
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.storeId, requireTenantId()),
        eq(paymentIntents.provider, provider),
        eq(paymentIntents.providerReference, providerReference),
      ),
    )
    .limit(1);
  return intent ?? null;
}

export async function listPaymentIntentsForOrder(
  db: Database,
  orderId: string,
): Promise<PaymentIntent[]> {
  return db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.storeId, requireTenantId()), eq(paymentIntents.orderId, orderId)))
    .orderBy(desc(paymentIntents.createdAt));
}

export async function setPaymentIntentStatus(
  db: Database,
  intentId: string,
  status: string,
  patch: { providerReference?: string | null; lastError?: string | null } = {},
): Promise<PaymentIntent | null> {
  const [intent] = await db
    .update(paymentIntents)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(and(eq(paymentIntents.storeId, requireTenantId()), eq(paymentIntents.id, intentId)))
    .returning();
  return intent ?? null;
}

export async function recordRefund(
  db: Database,
  intentId: string,
  amount: Money,
  refundReference: string | null,
): Promise<PaymentIntent | null> {
  const [intent] = await db
    .select()
    .from(paymentIntents)
    .where(and(eq(paymentIntents.storeId, requireTenantId()), eq(paymentIntents.id, intentId)))
    .limit(1);
  if (!intent) return null;

  const refundedMinor = intent.refundedMinor + amount.amount;
  // Refunded everything: 'refunded'. Refunded some: 'partially_refunded'.
  const status = refundedMinor >= intent.amountMinor ? 'refunded' : 'partially_refunded';

  const [updated] = await db
    .update(paymentIntents)
    .set({
      refundedMinor,
      status,
      providerReference: refundReference ?? intent.providerReference,
      updatedAt: new Date(),
    })
    .where(and(eq(paymentIntents.storeId, requireTenantId()), eq(paymentIntents.id, intentId)))
    .returning();
  return updated ?? null;
}

export type RecordEventResult =
  | { applied: true; event: PaymentEvent; intent: PaymentIntent | null }
  /** The provider sent this event id before: do not apply it again. */
  | { applied: false; reason: 'duplicate'; event: null; intent: null }
  /** The provider's amount disagrees with ours: reject and alert, never trust. */
  | { applied: false; reason: 'amount_mismatch'; event: null; intent: PaymentIntent | null };

/**
 * Claims and applies one webhook event, in a single transaction.
 *
 * The insert is the claim: `payment_events` has a unique index on
 * (store_id, provider, provider_event_id), so two workers racing on the same
 * delivery cannot both apply it.
 */
export async function recordWebhookEvent(
  db: Database,
  input: {
    provider: string;
    providerEventId: string;
    intentId: string | null;
    type: string | null;
    status: string | null;
    /** What the provider says was paid, if it says. Null means "not stated". */
    reportedAmount: Money | null;
    payload: unknown;
  },
): Promise<RecordEventResult> {
  const storeId = requireTenantId();

  return db.transaction(async (tx) => {
    const claimed: NewPaymentEvent = {
      storeId,
      provider: input.provider,
      providerEventId: input.providerEventId,
      intentId: input.intentId,
      type: input.type,
      status: input.status,
      payload: input.payload as Record<string, unknown>,
    };

    /*
     * The insert *is* the claim. `onConflictDoNothing` rather than a
     * try/catch: a caught unique violation leaves the transaction aborted, so
     * the follow-up reads inside this same transaction would fail anyway.
     */
    const [claimedEvent] = await tx
      .insert(paymentEvents)
      .values(claimed)
      .onConflictDoNothing()
      .returning();
    if (!claimedEvent) {
      return { applied: false, reason: 'duplicate', event: null, intent: null };
    }
    const event: PaymentEvent = claimedEvent;

    if (!input.intentId) return { applied: true, event, intent: null };

    const [intent] = await tx
      .select()
      .from(paymentIntents)
      .where(and(eq(paymentIntents.storeId, storeId), eq(paymentIntents.id, input.intentId)))
      .limit(1);
    if (!intent) return { applied: true, event, intent: null };

    const ours = money(intent.amountMinor, intent.currency);
    if (input.reportedAmount && !sameMoney(ours, input.reportedAmount)) {
      // Recorded, but deliberately not applied: a mismatch is a signal, not a
      // rounding error.
      await tx
        .update(paymentIntents)
        .set({
          lastError: `Amount mismatch: expected ${ours.amount} ${ours.currency}, provider reported ${input.reportedAmount.amount} ${input.reportedAmount.currency}.`,
          updatedAt: new Date(),
        })
        .where(eq(paymentIntents.id, intent.id));
      return { applied: false, reason: 'amount_mismatch', event: null, intent };
    }

    if (input.status && input.status !== intent.status) {
      const [updated] = await tx
        .update(paymentIntents)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(paymentIntents.id, intent.id))
        .returning();
      return { applied: true, event, intent: updated ?? intent };
    }

    return { applied: true, event, intent };
  });
}

function sameMoney(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

export async function listPaymentEvents(
  db: Database,
  intentId: string,
  limit = 20,
): Promise<PaymentEvent[]> {
  return db
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.storeId, requireTenantId()), eq(paymentEvents.intentId, intentId)))
    .orderBy(desc(paymentEvents.processedAt))
    .limit(limit);
}
