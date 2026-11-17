export { PAYMENT_PROVIDERS, PAYMENT_STATUSES, PaymentError, isPaymentProvider } from './gateway.js';
export type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentGateway,
  PaymentProvider,
  PaymentStatus,
  ProviderEvent,
  WebhookVerification,
} from './gateway.js';

export { createCashOnDeliveryGateway, createManualTransferGateway } from './adapters/offline.js';
export {
  createPaymobGateway,
  paymobBaseUrl,
  paymobHmac,
  type PaymobConfig,
} from './adapters/paymob.js';
export {
  createFawryGateway,
  fawryBaseUrl,
  fawrySignature,
  type FawryConfig,
} from './adapters/fawry.js';

export { PaymentRegistry, buildGateways, paymentRegistry, type PaymentsEnv } from './registry.js';
