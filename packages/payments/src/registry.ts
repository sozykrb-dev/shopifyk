import { createCashOnDeliveryGateway, createManualTransferGateway } from './adapters/offline.js';
import { createFawryGateway, type FawryConfig } from './adapters/fawry.js';
import { createPaymobGateway, type PaymobConfig } from './adapters/paymob.js';
import {
  PAYMENT_PROVIDERS,
  isPaymentProvider,
  type PaymentGateway,
  type PaymentProvider,
} from './gateway.js';

/**
 * Payment provider registry.
 *
 * Checkout asks "which methods can this shopper use?" and gets a list; it never
 * branches on provider. Credentials come from the environment, so no adapter
 * can reach a live gateway unless the deployment actually holds live keys.
 */

export type PaymentsEnv = {
  PAYMOB_API_KEY?: string;
  PAYMOB_SECRET_KEY?: string;
  PAYMOB_HMAC_SECRET?: string;
  PAYMOB_CARD_INTEGRATION_ID?: string;
  PAYMOB_WALLET_INTEGRATION_ID?: string;
  PAYMOB_PUBLIC_KEY?: string;
  PAYMOB_LIVE?: string;
  FAWRY_MERCHANT_CODE?: string;
  FAWRY_SECURITY_KEY?: string;
  FAWRY_LIVE?: string;
  MANUAL_TRANSFER_BANK?: string;
  MANUAL_TRANSFER_ACCOUNT_NAME?: string;
  MANUAL_TRANSFER_ACCOUNT_NUMBER?: string;
  MANUAL_TRANSFER_IBAN?: string;
};

function truthy(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

/** Builds every adapter from the environment, filtering out the unconfigured. */
export function buildGateways(env: PaymentsEnv = process.env as PaymentsEnv): PaymentGateway[] {
  const gateways: PaymentGateway[] = [createCashOnDeliveryGateway()];

  if (env.MANUAL_TRANSFER_ACCOUNT_NUMBER) {
    gateways.push(
      createManualTransferGateway({
        bankNameAr: env.MANUAL_TRANSFER_BANK ?? 'بنك',
        bankNameEn: env.MANUAL_TRANSFER_BANK ?? 'Bank',
        accountName: env.MANUAL_TRANSFER_ACCOUNT_NAME ?? '',
        accountNumber: env.MANUAL_TRANSFER_ACCOUNT_NUMBER,
        iban: env.MANUAL_TRANSFER_IBAN,
      }),
    );
  }

  const paymob: PaymobConfig | null =
    env.PAYMOB_API_KEY && env.PAYMOB_CARD_INTEGRATION_ID && env.PAYMOB_HMAC_SECRET
      ? {
          apiKey: env.PAYMOB_API_KEY,
          secretKey: env.PAYMOB_SECRET_KEY ?? '',
          hmacSecret: env.PAYMOB_HMAC_SECRET,
          cardIntegrationId: env.PAYMOB_CARD_INTEGRATION_ID,
          walletIntegrationId: env.PAYMOB_WALLET_INTEGRATION_ID,
          publicKey: env.PAYMOB_PUBLIC_KEY,
          live: truthy(env.PAYMOB_LIVE),
        }
      : null;
  if (paymob) gateways.push(createPaymobGateway(paymob));

  const fawry: FawryConfig | null =
    env.FAWRY_MERCHANT_CODE && env.FAWRY_SECURITY_KEY
      ? {
          merchantCode: env.FAWRY_MERCHANT_CODE,
          securityKey: env.FAWRY_SECURITY_KEY,
          live: truthy(env.FAWRY_LIVE),
        }
      : null;
  if (fawry) gateways.push(createFawryGateway(fawry));

  return gateways;
}

/** A registry that only knows the methods a store has actually switched on. */
export class PaymentRegistry {
  private readonly byProvider = new Map<PaymentProvider, PaymentGateway>();

  constructor(gateways: readonly PaymentGateway[]) {
    for (const gateway of gateways) {
      if (gateway.isAvailable()) this.byProvider.set(gateway.provider, gateway);
    }
  }

  /** Methods offered at checkout, in a stable, sensible-to-show order. */
  list(): PaymentGateway[] {
    return PAYMENT_PROVIDERS.map((provider) => this.byProvider.get(provider)).filter(
      (gateway): gateway is PaymentGateway => gateway !== undefined,
    );
  }

  get(provider: string): PaymentGateway | null {
    if (!isPaymentProvider(provider)) return null;
    return this.byProvider.get(provider) ?? null;
  }

  /** Never undefined: an unknown provider falls back to cash on delivery. */
  require(provider: string): PaymentGateway {
    const gateway = this.get(provider);
    if (gateway) return gateway;
    const fallback = this.byProvider.get('cash_on_delivery');
    if (fallback) return fallback;
    throw new Error('No payment method is configured, not even cash on delivery.');
  }
}

/** The registry for the current process, built from the environment. */
export function paymentRegistry(env?: PaymentsEnv): PaymentRegistry {
  return new PaymentRegistry(buildGateways(env));
}
