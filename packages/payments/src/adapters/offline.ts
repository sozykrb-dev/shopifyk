import type { Money } from '@velnorix/core';
import {
  PaymentError,
  type CreatePaymentInput,
  type CreatePaymentResult,
  type PaymentGateway,
  type PaymentStatus,
} from '../gateway.js';

/**
 * Cash on delivery.
 *
 * A first-class adapter, not a special case in checkout (ADR 0007): it simply
 * has no external confirmation step. The money is collected at the door, so
 * the intent stays `pending` until somebody marks it collected.
 */
export function createCashOnDeliveryGateway(
  config: { labelAr?: string; labelEn?: string } = {},
): PaymentGateway {
  return {
    provider: 'cash_on_delivery',
    live: true,
    labelAr: config.labelAr ?? 'الدفع عند الاستلام',
    labelEn: config.labelEn ?? 'Cash on delivery',

    isAvailable: () => true,

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      // COD has no off-site step and no provider reference of its own: our
      // intent id is the reference, so webhooks and admin screens have one
      // identifier to follow.
      return {
        providerReference: `cod:${input.intentId}`,
        status: 'pending',
        redirectUrl: null,
        instructions: 'سيتم تحصيل المبلغ نقدًا عند التوصيل.',
      };
    },

    async capturePayment(providerReference: string, amount?: Money): Promise<PaymentStatus> {
      if (!providerReference.startsWith('cod:')) {
        throw new PaymentError('provider_rejected', 'Not a cash-on-delivery reference.');
      }
      if (amount && amount.amount <= 0) {
        throw new PaymentError('invalid_amount', 'Cannot collect zero or less.');
      }
      return 'captured';
    },

    async refundPayment() {
      // A COD order is refunded by handing the money back, off-platform.
      throw new PaymentError(
        'not_supported',
        'Cash on delivery is refunded off-platform; record the refund manually.',
      );
    },

    parseWebhook() {
      // No webhooks: a human confirms collection.
      return { verified: false, reason: 'Cash on delivery has no webhook.' };
    },
  };
}

/**
 * Manual bank transfer.
 *
 * First-class for the same reason COD is: Egyptian merchants accept transfers
 * constantly, and modelling that as "no payment method" would be a lie. The
 * customer is given the account details; the merchant confirms receipt.
 */
export function createManualTransferGateway(config: {
  bankNameAr: string;
  bankNameEn: string;
  accountName: string;
  accountNumber: string;
  iban?: string;
}): PaymentGateway {
  const instructions = [
    `${config.bankNameAr} — ${config.accountName}`,
    `رقم الحساب: ${config.accountNumber}`,
    config.iban ? `IBAN: ${config.iban}` : null,
    'حوّل المبلغ ثم أرسل صورة الإيصال، وسيتم تأكيد الطلب بعد التحصيل.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    provider: 'manual_transfer',
    live: true,
    labelAr: 'تحويل بنكي',
    labelEn: 'Bank transfer',

    isAvailable: () => Boolean(config.accountNumber),

    async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
      return {
        providerReference: `transfer:${input.intentId}`,
        status: 'pending',
        redirectUrl: null,
        instructions,
      };
    },

    async capturePayment(providerReference: string): Promise<PaymentStatus> {
      if (!providerReference.startsWith('transfer:')) {
        throw new PaymentError('provider_rejected', 'Not a manual transfer reference.');
      }
      return 'captured';
    },

    async refundPayment() {
      throw new PaymentError(
        'not_supported',
        'Bank transfers are refunded off-platform; record the refund manually.',
      );
    },

    parseWebhook() {
      return { verified: false, reason: 'Manual transfer has no webhook.' };
    },
  };
}
