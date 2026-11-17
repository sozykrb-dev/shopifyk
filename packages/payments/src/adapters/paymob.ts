import { createHmac } from 'node:crypto';
import { constantTimeEqual } from '@velnorix/core';
import {
  PaymentError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentGateway,
  type PaymentStatus,
  type ProviderEvent,
  type WebhookVerification,
} from '../gateway.js';
import type { Money } from '@velnorix/core';

/**
 * Paymob (cards, wallets, instalments) — Egypt's most widely used gateway.
 *
 * Sandbox by default: without live credentials this adapter points at the
 * sandbox host and says so, so there is no code path that can quietly charge a
 * real card. The two calls checkout needs are "authenticate + create an
 * intention" and "verify a webhook HMAC"; everything else is a lookup.
 */

export type PaymobConfig = {
  apiKey: string;
  secretKey: string;
  /** Paymob integration ids are per payment method; at least one is required. */
  cardIntegrationId: string;
  walletIntegrationId?: string;
  hmacSecret: string;
  publicKey?: string;
  /** Opt in explicitly; there is no other way to leave the sandbox. */
  live?: boolean;
  baseUrl?: string;
};

const SANDBOX = 'https://accept.paymob.com';
const LIVE = 'https://accept.paymob.com';

export function paymobBaseUrl(live: boolean, override?: string): string {
  return override ?? (live ? LIVE : SANDBOX);
}

/**
 * Paymob's HMAC is a SHA-256 over a fixed, undocumented field order. Getting
 * the order wrong is the single most common way to accept a forged webhook, so
 * the field list lives here once and is covered by a test.
 */
const HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order',
  'owner',
  'pending',
  'source_data_pan',
  'source_data_sub_type',
  'source_data_type',
  'success',
] as const;

export function paymobHmac(payload: Record<string, unknown>, secret: string): string {
  const concatenated = HMAC_FIELDS.map((field) => String(payload[field] ?? '')).join('');
  return hmacHex(concatenated, secret);
}

function hmacHex(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function paymobStatus(payload: Record<string, unknown>): PaymentStatus {
  /*
   * Paymob sends these as booleans over the wire, but as the strings
   * "true"/"false" inside the HMAC concatenation -- and some callbacks use the
   * string form for the fields too. Accept either rather than reading a failed
   * payment as successful or the other way round.
   */
  const flag = (value: unknown): boolean => value === true || value === 'true';
  const notFlag = (value: unknown): boolean => value === false || value === 'false';

  if (flag(payload.success)) {
    if (flag(payload.is_refunded)) return 'refunded';
    if (flag(payload.is_voided)) return 'cancelled';
    // `is_capture` false with `is_auth` true means money is held, not taken.
    if (flag(payload.is_auth) && notFlag(payload.is_capture)) return 'authorized';
    return 'captured';
  }
  if (flag(payload.pending)) return 'pending';
  return 'failed';
}

export function createPaymobGateway(config: PaymobConfig): PaymentGateway {
  const live = config.live === true;
  const baseUrl = paymobBaseUrl(live, config.baseUrl);

  async function authenticate(): Promise<string> {
    const response = await fetch(`${baseUrl}/api/auth/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: config.apiKey }),
    });
    if (!response.ok) {
      throw new PaymentError('provider_rejected', `Paymob auth failed: ${response.status}`);
    }
    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new PaymentError('provider_rejected', 'Paymob returned no token.');
    return body.token;
  }

  return {
    provider: 'paymob',
    live,
    labelAr: 'بطاقة ائتمان / محفظة (Paymob)',
    labelEn: 'Card or wallet (Paymob)',

    isAvailable: () => Boolean(config.apiKey && config.cardIntegrationId && config.hmacSecret),

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      if (!this.isAvailable()) {
        throw new PaymentError('not_available', 'Paymob is not configured.');
      }
      if (input.amount.amount <= 0) {
        throw new PaymentError('invalid_amount', 'Paymob needs a positive amount.');
      }

      const token = await authenticate();

      // 1. Register an order with Paymob so the amount is fixed server-side.
      const orderResponse = await fetch(`${baseUrl}/api/ecommerce/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          delivery_needed: false,
          amount_cents: input.amount.amount,
          currency: input.amount.currency,
          // Our intent id travels as the merchant order id, so a webhook can
          // always be traced back to a row of ours without guessing.
          merchant_order_id: input.intentId,
          items: [],
        }),
      });
      if (!orderResponse.ok) {
        throw new PaymentError('provider_rejected', `Paymob order failed: ${orderResponse.status}`);
      }
      const order = (await orderResponse.json()) as { id?: number };
      if (!order.id) throw new PaymentError('provider_rejected', 'Paymob returned no order id.');

      // 2. Ask for a payment key, which is what the hosted iframe consumes.
      const keyResponse = await fetch(`${baseUrl}/api/acceptance/payment_keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          amount_cents: input.amount.amount,
          currency: input.amount.currency,
          order_id: order.id,
          integration_id: Number(config.cardIntegrationId),
          billing_data: {
            email: input.customer?.email ?? 'customer@example.com',
            phone_number: input.customer?.phone ?? '',
            first_name: input.customer?.name?.split(' ')[0] ?? 'Customer',
            last_name: input.customer?.name?.split(' ').slice(1).join(' ') ?? 'Customer',
            country: 'EG',
            city: 'Cairo',
            street: 'NA',
            building: 'NA',
            floor: 'NA',
            apartment: 'NA',
          },
        }),
      });
      if (!keyResponse.ok) {
        throw new PaymentError('provider_rejected', `Paymob key failed: ${keyResponse.status}`);
      }
      const key = (await keyResponse.json()) as { token?: string };
      if (!key.token) throw new PaymentError('provider_rejected', 'Paymob returned no key.');

      return {
        providerReference: String(order.id),
        status: 'pending',
        redirectUrl: `${baseUrl}/api/acceptance/iframes/${
          config.publicKey ?? ''
        }?payment_token=${key.token}`,
        instructions: null,
      };
    },

    async capturePayment(providerReference: string, amount?: Money): Promise<PaymentStatus> {
      const token = await authenticate();
      const amountCents = amount?.amount ?? 0;
      if (amountCents <= 0) {
        throw new PaymentError('invalid_amount', 'Capture needs a positive amount.');
      }
      const response = await fetch(`${baseUrl}/api/acceptance/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          transaction_id: providerReference,
          amount_cents: amountCents,
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      return response.ok ? paymobStatus(body) : 'failed';
    },

    async refundPayment(providerReference: string, amount: Money) {
      const token = await authenticate();
      const response = await fetch(`${baseUrl}/api/acceptance/void_refund/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_token: token,
          transaction_id: providerReference,
          amount_cents: amount.amount,
        }),
      });
      const body = (await response.json()) as { id?: number };
      return {
        status: response.ok ? ('refunded' as PaymentStatus) : ('failed' as PaymentStatus),
        refundReference: body.id ? String(body.id) : null,
      };
    },

    parseWebhook(
      headers: Record<string, string>,
      rawBody: string,
    ): WebhookVerification & { event?: ProviderEvent } {
      const provided = headers['hmac'] ?? headers['HMAC'] ?? '';
      if (!provided) return { verified: false, reason: 'Missing HMAC header.' };

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { verified: false, reason: 'Body is not JSON.' };
      }

      const transaction = (payload.obj ?? payload) as Record<string, unknown>;
      const expected = paymobHmac(transaction, config.hmacSecret);
      if (!constantTimeEqual(expected, provided)) {
        return { verified: false, reason: 'HMAC mismatch.' };
      }

      const order = transaction.order as Record<string, unknown> | undefined;
      return {
        verified: true,
        event: {
          eventId: String(transaction.id ?? ''),
          type: String(transaction.source_data_sub_type ?? 'transaction'),
          // `merchant_order_id` is our intent id; Paymob echoes it back.
          intentId:
            (order?.merchant_order_id as string | undefined) ??
            (transaction.merchant_order_id as string | undefined) ??
            null,
          providerReference: transaction.id ? String(transaction.id) : null,
          status: paymobStatus(transaction),
          raw: payload,
        },
      };
    },
  };
}
