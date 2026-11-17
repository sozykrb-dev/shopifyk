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
 * Fawry — pay at any Fawry kiosk with a reference number.
 *
 * Egypt runs on this: a large share of online orders are paid in cash at a
 * kiosk. The customer gets a reference number and a couple of days to pay; the
 * order is created unpaid and Fawry tells us later, by webhook, that it was
 * settled.
 */

export type FawryConfig = {
  merchantCode: string;
  securityKey: string;
  /** Opt in explicitly; there is no other way to leave the sandbox. */
  live?: boolean;
  baseUrl?: string;
  /** Hours the reference number stays valid (Fawry default is 72). */
  expiryHours?: number;
};

const SANDBOX = 'https://atfawry.fawrystaging.com';
const LIVE = 'https://www.atfawry.com';

export function fawryBaseUrl(live: boolean, override?: string): string {
  return override ?? (live ? LIVE : SANDBOX);
}

/**
 * Fawry signs requests and webhooks with a SHA-256 over the merchant code, the
 * reference number and the amounts in a fixed order. The concatenation lives
 * here once and is covered by a test.
 */
export function fawrySignature(parts: {
  merchantCode: string;
  referenceNumber: string;
  amount: number;
  expiry?: number;
  securityKey: string;
}): string {
  const base = `${parts.merchantCode}${parts.referenceNumber}${parts.amount.toFixed(2)}`;
  const withExpiry = parts.expiry ? `${base}${parts.expiry}` : base;
  return createHmac('sha256', parts.securityKey).update(withExpiry).digest('hex');
}

function fawryStatus(code: unknown): PaymentStatus {
  // Fawry's status codes: 1 unpaid, 2 paid, 3 delivered, 4 refunded,
  // 5 cancelled/expired, 6 partially refunded.
  switch (Number(code)) {
    case 2:
    case 3:
      return 'captured';
    case 4:
      return 'refunded';
    case 5:
      return 'cancelled';
    case 6:
      return 'partially_refunded';
    default:
      return 'pending';
  }
}

export function createFawryGateway(config: FawryConfig): PaymentGateway {
  const live = config.live === true;
  const baseUrl = fawryBaseUrl(live, config.baseUrl);
  const expiryHours = config.expiryHours ?? 72;

  return {
    provider: 'fawry',
    live,
    labelAr: 'الدفع عبر فوري',
    labelEn: 'Pay at Fawry',

    isAvailable: () => Boolean(config.merchantCode && config.securityKey),

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      if (!this.isAvailable()) {
        throw new PaymentError('not_available', 'Fawry is not configured.');
      }
      if (input.amount.amount <= 0) {
        throw new PaymentError('invalid_amount', 'Fawry needs a positive amount.');
      }

      const expiry = Date.now() + expiryHours * 60 * 60 * 1000;
      // The reference number must be unique per merchant, so it is derived
      // from our own intent id rather than generated per attempt.
      const referenceNumber = input.intentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
      const signature = fawrySignature({
        merchantCode: config.merchantCode,
        referenceNumber,
        // Fawry expects major units with two decimals; minor units / 100.
        amount: input.amount.amount / 100,
        expiry,
        securityKey: config.securityKey,
      });

      const response = await fetch(`${baseUrl}/ECommerceWeb/Fawry/payments/charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantCode: config.merchantCode,
          merchantRefNum: referenceNumber,
          customerName: input.customer?.name ?? 'Velnorix Customer',
          customerMobile: input.customer?.phone ?? '',
          customerEmail: input.customer?.email ?? '',
          paymentExpiry: expiry,
          amount: input.amount.amount / 100,
          currencyCode: input.amount.currency,
          description: `Order #${input.orderNumber}`,
          signature,
          paymentMethod: 'PAYATFAWRY',
        }),
      });

      if (!response.ok) {
        throw new PaymentError('provider_rejected', `Fawry charge failed: ${response.status}`);
      }
      const body = (await response.json()) as { referenceNumber?: string; statusCode?: number };
      const reference = body.referenceNumber ?? referenceNumber;

      return {
        providerReference: reference,
        status: 'pending',
        redirectUrl: null,
        instructions:
          `رقم المرجع: ${reference}\n` +
          `ادفع المبلغ (${(input.amount.amount / 100).toFixed(2)} ${input.amount.currency}) ` +
          `في أي فرع فوري خلال ${expiryHours} ساعة.`,
      };
    },

    async capturePayment(): Promise<PaymentStatus> {
      // Fawry settles by webhook; there is no separate capture call.
      throw new PaymentError('not_supported', 'Fawry settles by webhook, not by capture.');
    },

    async refundPayment(providerReference: string, amount: Money) {
      const signature = fawrySignature({
        merchantCode: config.merchantCode,
        referenceNumber: providerReference,
        amount: amount.amount / 100,
        securityKey: config.securityKey,
      });
      const response = await fetch(`${baseUrl}/ECommerceWeb/Fawry/payments/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchantCode: config.merchantCode,
          referenceNumber: providerReference,
          refundAmount: amount.amount / 100,
          reason: 'Merchant refund',
          signature,
        }),
      });
      const body = (await response.json()) as { statusCode?: number };
      return {
        status: response.ok && body.statusCode === 4 ? ('refunded' as PaymentStatus) : 'failed',
        refundReference: providerReference,
      };
    },

    parseWebhook(
      headers: Record<string, string>,
      rawBody: string,
    ): WebhookVerification & { event?: ProviderEvent } {
      const provided = headers['signature'] ?? headers['Signature'] ?? '';
      if (!provided) return { verified: false, reason: 'Missing signature header.' };

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { verified: false, reason: 'Body is not JSON.' };
      }

      const referenceNumber = String(payload.merchantRefNumber ?? payload.merchantRefNum ?? '');
      const expected = fawrySignature({
        merchantCode: config.merchantCode,
        referenceNumber,
        amount: Number(payload.paymentAmount ?? payload.orderAmount ?? 0),
        securityKey: config.securityKey,
      });
      if (!constantTimeEqual(expected, provided)) {
        return { verified: false, reason: 'Signature mismatch.' };
      }

      return {
        verified: true,
        event: {
          eventId: String(payload.fawryRefNumber ?? payload.fawryRefNum ?? referenceNumber),
          type: 'payment_status',
          intentId: referenceNumber || null,
          providerReference: String(payload.fawryRefNumber ?? payload.fawryRefNum ?? ''),
          status: fawryStatus(payload.orderStatus ?? payload.statusCode),
          raw: payload,
        },
      };
    },
  };
}
