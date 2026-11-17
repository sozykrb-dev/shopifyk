import { NextResponse } from 'next/server';
import { money } from '@velnorix/core';
import { paymentRegistry } from '@velnorix/payments';
import {
  getPaymentIntentByReference,
  recordWebhookEvent,
  setPaymentIntentStatus,
  withTenant,
} from '@velnorix/db';
import { resolveStoreWithSettings, getStorefrontContext } from '@/lib/tenant.js';

export const dynamic = 'force-dynamic';

/**
 * Payment webhooks: `/api/payments/webhook/[provider]`.
 *
 * Three rules, in order:
 *
 *   1. **Verify the signature** before doing anything with the body. An
 *      unverified webhook is an unauthenticated API for marking orders paid.
 *   2. **Never trust the amount.** The money is read from *our* intent row; a
 *      webhook that disagrees is recorded and rejected, not believed.
 *   3. **Be idempotent.** `recordWebhookEvent` claims the provider's event id
 *      under a unique index, so a replay is reported as a duplicate instead of
 *      applying the same payment twice.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  const context = await getStorefrontContext();
  const resolved = await resolveStoreWithSettings(context);
  // Unknown host: 404 rather than 403, so the endpoint cannot be used to probe
  // which hosts are real.
  if (!resolved) return new NextResponse(null, { status: 404 });

  const gateway = paymentRegistry().get(provider);
  if (!gateway) return new NextResponse(null, { status: 404 });

  // The raw body, not a re-serialised object: signatures cover exact bytes.
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const parsed = gateway.parseWebhook(headers, rawBody);
  if (!parsed.verified) {
    return NextResponse.json({ error: 'unverified', reason: parsed.reason }, { status: 400 });
  }

  const event = parsed.event;
  if (!event) return NextResponse.json({ error: 'no_event' }, { status: 400 });

  const result = await withTenant(resolved.store.id, (db) =>
    recordWebhookEvent(db, {
      provider: gateway.provider,
      providerEventId: event.eventId,
      intentId: event.intentId,
      type: event.type,
      status: event.status,
      reportedAmount: reportedAmount(event.raw),
      payload: event.raw,
    }),
  );

  if (!result.applied && result.reason === 'duplicate') {
    // Already applied. 200, not an error: the provider must stop retrying.
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!result.applied && result.reason === 'amount_mismatch') {
    // Recorded but not applied. 409 so the provider retries and the mismatch
    // shows up in our logs instead of silently passing.
    return NextResponse.json({ error: 'amount_mismatch' }, { status: 409 });
  }

  // Providers that only give us a reference: find the intent by it.
  if (!event.intentId && event.providerReference) {
    const intent = await withTenant(resolved.store.id, (db) =>
      getPaymentIntentByReference(db, gateway.provider, event.providerReference!),
    );
    if (intent && event.status) {
      await withTenant(resolved.store.id, (db) =>
        setPaymentIntentStatus(db, intent.id, event.status!),
      );
    }
  }

  return NextResponse.json({ ok: true });
}

/**
 * The amount the provider says was paid, in our own Money type.
 *
 * Null when the payload does not state one -- an absent amount is not a
 * mismatch, it is just unstated, and we compare against our row either way.
 */
function reportedAmount(raw: unknown): ReturnType<typeof money> | null {
  if (!raw || typeof raw !== 'object') return null;
  const payload = raw as Record<string, unknown>;
  const cents =
    typeof payload.amount_cents === 'number'
      ? payload.amount_cents
      : typeof payload.orderAmount === 'number'
        ? // Fawry reports major units; Paymob reports minor.
          Math.round(payload.orderAmount * 100)
        : null;
  const currency =
    typeof payload.currency === 'string'
      ? payload.currency
      : typeof payload.currencyCode === 'string'
        ? payload.currencyCode
        : null;
  if (cents === null || !currency) return null;
  try {
    return money(cents, currency);
  } catch {
    return null;
  }
}
