import type { Money } from '@velnorix/core';

/**
 * The payment gateway contract (ADR 0007).
 *
 * One interface, several adapters. The rest of the system never branches on
 * provider: checkout asks for a payment, and gets back the same shape whether
 * that payment is a card through Paymob, a Fawry reference number, cash on
 * delivery, or a bank transfer the merchant confirms by hand.
 *
 * Nothing in here talks to a network during tests, and no adapter can reach a
 * live gateway without live credentials from the environment.
 */

export const PAYMENT_PROVIDERS = [
  'cash_on_delivery',
  'manual_transfer',
  'paymob',
  'fawry',
] as const;

export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export function isPaymentProvider(value: string): value is PaymentProvider {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

/** Where a payment intent stands. A state machine, not a boolean. */
export const PAYMENT_STATUSES = [
  'pending',
  'authorized',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type CreatePaymentInput = {
  /** Our own intent id -- the provider never gets to name our rows. */
  intentId: string;
  /** Human-facing order number, sent to gateways as the merchant reference. */
  orderNumber: number;
  amount: Money;
  /** Where to send the customer after an off-site checkout, if any. */
  returnUrl?: string;
  customer?: { email?: string; phone?: string; name?: string };
  /** Free-form per-provider extras (Paymob integration id, Fawry expiry…). */
  metadata?: Record<string, string>;
};

export type CreatePaymentResult = {
  /** The provider's own reference, which is what webhooks arrive with. */
  providerReference: string;
  status: PaymentStatus;
  /**
   * Where to send the customer next: a hosted checkout page for card
   * providers, or null for providers with no off-site step (COD, transfer).
   */
  redirectUrl: string | null;
  /**
   * Instructions shown to the customer instead of a redirect: a Fawry
   * reference number, or the bank account to transfer to.
   */
  instructions: string | null;
};

export type ProviderEvent = {
  /** The provider's event id. Stored uniquely: a replay must not re-apply. */
  eventId: string;
  type: string;
  /** Our intent id, recovered from the provider's reference. */
  intentId: string | null;
  providerReference: string | null;
  status: PaymentStatus | null;
  raw: unknown;
};

export type WebhookVerification = {
  /** False means "reject", never "assume it is fine". */
  verified: boolean;
  reason?: string;
};

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  /** True when the adapter has live credentials and may leave the sandbox. */
  readonly live: boolean;
  /** Human-readable label for the checkout UI. */
  readonly labelAr: string;
  readonly labelEn: string;

  /** Whether the method is offered at all right now (credentials, country…). */
  isAvailable(): boolean;

  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;

  capturePayment(providerReference: string, amount?: Money): Promise<PaymentStatus>;

  refundPayment(
    providerReference: string,
    amount: Money,
    reason?: string,
  ): Promise<{ status: PaymentStatus; refundReference: string | null }>;

  /**
   * Verifies the signature and normalises the payload.
   *
   * Signature verification is the adapter's job because every provider signs
   * differently; idempotency is the caller's, because that is a property of
   * our own event table.
   */
  parseWebhook(
    headers: Record<string, string>,
    rawBody: string,
  ): WebhookVerification & {
    event?: ProviderEvent;
  };
}

/** Thrown when an adapter is asked to do something it cannot do. */
export class PaymentError extends Error {
  readonly code:
    | 'not_available'
    | 'invalid_amount'
    | 'invalid_signature'
    | 'provider_rejected'
    | 'not_supported';

  constructor(code: PaymentError['code'], message: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}
