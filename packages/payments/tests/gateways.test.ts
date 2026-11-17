import { describe, expect, it } from 'vitest';
import { money } from '@velnorix/core';
import {
  PaymentError,
  PaymentRegistry,
  buildGateways,
  createCashOnDeliveryGateway,
  createFawryGateway,
  createManualTransferGateway,
  createPaymobGateway,
  fawryBaseUrl,
  fawrySignature,
  isPaymentProvider,
  paymobBaseUrl,
  paymobHmac,
  type PaymentGateway,
} from '../src/index.js';

/**
 * Payment adapters, tested without a network.
 *
 * The three properties that matter and are easy to lose: a forged webhook must
 * be rejected, an unconfigured provider must not be offered, and no adapter may
 * claim to be live without being told to.
 */

const INTENT = '7a2f0d1c-5c0a-4b7e-9f2e-1d3c4b5a6978';

describe('cash on delivery', () => {
  const gateway = createCashOnDeliveryGateway();

  it('is always available and never live-dependent', () => {
    expect(gateway.isAvailable()).toBe(true);
    expect(gateway.live).toBe(true);
    expect(gateway.provider).toBe('cash_on_delivery');
  });

  it('has no off-site step and tells the customer what will happen', async () => {
    const result = await gateway.createPayment({
      intentId: INTENT,
      orderNumber: 1001,
      amount: money(219_900, 'EGP'),
    });
    expect(result.redirectUrl).toBeNull();
    expect(result.instructions).toContain('عند التوصيل');
    expect(result.status).toBe('pending');
    // Our intent id travels as the reference, so there is one identifier.
    expect(result.providerReference).toBe(`cod:${INTENT}`);
  });

  it('stays pending until somebody collects the money', async () => {
    expect(await gateway.capturePayment(`cod:${INTENT}`, money(219_900, 'EGP'))).toBe('captured');
  });

  it('refuses to collect a reference that is not its own', async () => {
    await expect(gateway.capturePayment('paymob:123', money(100, 'EGP'))).rejects.toThrow(
      PaymentError,
    );
    await expect(gateway.capturePayment(`cod:${INTENT}`, money(0, 'EGP'))).rejects.toThrow(
      /zero or less/,
    );
  });

  it('has no webhook, and says so instead of pretending to verify', () => {
    expect(gateway.parseWebhook({}, '{}').verified).toBe(false);
  });

  it('records refunds as off-platform rather than failing silently', async () => {
    await expect(gateway.refundPayment(`cod:${INTENT}`, money(100, 'EGP'))).rejects.toThrow(
      /off-platform/,
    );
  });
});

describe('manual bank transfer', () => {
  const gateway = createManualTransferGateway({
    bankNameAr: 'بنك مصر',
    bankNameEn: 'Banque Misr',
    accountName: 'متجر القاهرة',
    accountNumber: '1234567890',
    iban: 'EG1100000000000000000000001',
  });

  it('prints the account details the customer needs', async () => {
    const result = await gateway.createPayment({
      intentId: INTENT,
      orderNumber: 1002,
      amount: money(50_000, 'EGP'),
    });
    expect(result.instructions).toContain('1234567890');
    expect(result.instructions).toContain('EG1100000000000000000000001');
    expect(result.redirectUrl).toBeNull();
    expect(result.status).toBe('pending');
  });

  it('is unavailable without an account number', () => {
    const empty = createManualTransferGateway({
      bankNameAr: 'بنك',
      bankNameEn: 'Bank',
      accountName: 'x',
      accountNumber: '',
    });
    expect(empty.isAvailable()).toBe(false);
  });
});

describe('paymob', () => {
  const config = {
    apiKey: 'test-api-key',
    secretKey: 'test-secret',
    cardIntegrationId: '12345',
    hmacSecret: 'test-hmac-secret',
    publicKey: 'test-pk',
  };

  it('is sandbox unless explicitly told otherwise', () => {
    expect(createPaymobGateway(config).live).toBe(false);
    expect(createPaymobGateway({ ...config, live: true }).live).toBe(true);
  });

  it('is unavailable without credentials', () => {
    expect(
      createPaymobGateway({ ...config, apiKey: '', cardIntegrationId: '' }).isAvailable(),
    ).toBe(false);
  });

  it('signs the field order Paymob actually uses', () => {
    const payload = {
      amount_cents: '219900',
      created_at: '2026-11-17T10:00:00.000Z',
      currency: 'EGP',
      error_occured: 'false',
      has_parent_transaction: 'false',
      id: '999',
      integration_id: '12345',
      is_3d_secure: 'false',
      is_auth: 'false',
      is_capture: 'true',
      is_refunded: 'false',
      is_standalone_payment: 'true',
      is_voided: 'false',
      order: { merchant_order_id: INTENT },
      owner: '1',
      pending: 'false',
      source_data_pan: '1234',
      source_data_sub_type: 'card',
      source_data_type: 'card',
      success: 'true',
    };
    const signature = paymobHmac(payload, config.hmacSecret);

    // Order-sensitive: swapping two fields must change the signature, or an
    // attacker could reorder a legitimate payload.
    const swapped = {
      ...payload,
      amount_cents: payload.created_at,
      created_at: payload.amount_cents,
    };
    expect(paymobHmac(swapped, config.hmacSecret)).not.toBe(signature);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a webhook with the wrong signature', () => {
    const gateway = createPaymobGateway(config);
    const body = JSON.stringify({
      obj: {
        id: 999,
        success: 'true',
        is_capture: 'true',
        order: { merchant_order_id: INTENT },
      },
    });
    const result = gateway.parseWebhook({ hmac: 'deadbeef' }, body);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('HMAC mismatch.');
    expect(result.event).toBeUndefined();
  });

  it('rejects a webhook with no signature at all', () => {
    const gateway = createPaymobGateway(config);
    expect(gateway.parseWebhook({}, '{}').verified).toBe(false);
    expect(gateway.parseWebhook({ hmac: 'x' }, 'not json').reason).toBe('Body is not JSON.');
  });

  it('accepts a correctly signed webhook and recovers our intent id', () => {
    const gateway = createPaymobGateway(config);
    const transaction = {
      id: 4242,
      success: 'true',
      is_capture: 'true',
      is_refunded: 'false',
      is_voided: 'false',
      source_data_sub_type: 'card',
      order: { merchant_order_id: INTENT },
    };
    const body = JSON.stringify({ obj: transaction });
    const result = gateway.parseWebhook({ hmac: paymobHmac(transaction, config.hmacSecret) }, body);
    expect(result.verified).toBe(true);
    expect(result.event?.intentId).toBe(INTENT);
    expect(result.event?.eventId).toBe('4242');
    expect(result.event?.status).toBe('captured');
  });

  it('reads authorised-but-not-captured as authorized, not captured', () => {
    const gateway = createPaymobGateway(config);
    const transaction = {
      id: 7,
      success: 'true',
      is_auth: 'true',
      is_capture: 'false',
      order: { merchant_order_id: INTENT },
    };
    const result = gateway.parseWebhook(
      { hmac: paymobHmac(transaction, config.hmacSecret) },
      JSON.stringify({ obj: transaction }),
    );
    expect(result.event?.status).toBe('authorized');
  });

  it('points at the sandbox host by default', () => {
    expect(paymobBaseUrl(false)).toContain('https://');
  });
});

describe('fawry', () => {
  const config = { merchantCode: 'MERCH', securityKey: 'fawry-secret' };
  const gateway = createFawryGateway(config);

  it('is sandbox unless explicitly told otherwise', () => {
    expect(gateway.live).toBe(false);
    expect(createFawryGateway({ ...config, live: true }).live).toBe(true);
    expect(fawryBaseUrl(false)).toContain('staging');
    expect(fawryBaseUrl(true)).toContain('atfawry.com');
  });

  it('signs the amount in major units, the way Fawry expects', () => {
    const signature = fawrySignature({
      merchantCode: 'MERCH',
      referenceNumber: 'ABC123',
      amount: 2199.0,
      securityKey: 'fawry-secret',
    });
    // A different amount must not produce the same signature.
    expect(
      fawrySignature({
        merchantCode: 'MERCH',
        referenceNumber: 'ABC123',
        amount: 1.0,
        securityKey: 'fawry-secret',
      }),
    ).not.toBe(signature);
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a webhook with the wrong signature', () => {
    const result = gateway.parseWebhook(
      { signature: 'deadbeef' },
      JSON.stringify({ merchantRefNumber: 'ABC123', paymentAmount: 2199, fawryRefNumber: 'F1' }),
    );
    expect(result.verified).toBe(false);
    expect(result.event).toBeUndefined();
  });

  it('accepts a correctly signed webhook and maps the status code', () => {
    const payload = {
      merchantRefNumber: 'ABC123',
      paymentAmount: 2199,
      fawryRefNumber: 'F1',
      orderStatus: 2, // paid
    };
    const signature = fawrySignature({
      merchantCode: config.merchantCode,
      referenceNumber: 'ABC123',
      amount: 2199,
      securityKey: config.securityKey,
    });
    const result = gateway.parseWebhook({ signature }, JSON.stringify(payload));
    expect(result.verified).toBe(true);
    expect(result.event?.status).toBe('captured');
    expect(result.event?.intentId).toBe('ABC123');
  });

  it('maps every Fawry status code to something we understand', () => {
    const statuses = [1, 2, 3, 4, 5, 6, 99];
    const mapped = statuses.map((orderStatus) => {
      const payload = { merchantRefNumber: 'R', paymentAmount: 1, orderStatus };
      const signature = fawrySignature({
        merchantCode: config.merchantCode,
        referenceNumber: 'R',
        amount: 1,
        securityKey: config.securityKey,
      });
      return gateway.parseWebhook({ signature }, JSON.stringify(payload)).event?.status;
    });
    expect(mapped).toEqual([
      'pending',
      'captured',
      'captured',
      'refunded',
      'cancelled',
      'partially_refunded',
      'pending',
    ]);
  });

  it('settles by webhook, so capture is not supported', async () => {
    await expect(gateway.capturePayment('F1')).rejects.toThrow(/webhook/);
  });
});

describe('registry', () => {
  it('offers cash on delivery even with no configuration at all', () => {
    const registry = new PaymentRegistry(buildGateways({}));
    expect(registry.list().map((gateway) => gateway.provider)).toEqual(['cash_on_delivery']);
  });

  it('only offers providers that are actually configured', () => {
    const registry = new PaymentRegistry(
      buildGateways({
        MANUAL_TRANSFER_ACCOUNT_NUMBER: '123',
        PAYMOB_API_KEY: 'k',
        PAYMOB_CARD_INTEGRATION_ID: '1',
        PAYMOB_HMAC_SECRET: 'h',
        // Fawry deliberately left unconfigured.
      }),
    );
    expect(registry.list().map((gateway) => gateway.provider)).toEqual([
      'cash_on_delivery',
      'manual_transfer',
      'paymob',
    ]);
    expect(registry.get('fawry')).toBeNull();
  });

  it('falls back to cash on delivery for an unknown provider', () => {
    const registry = new PaymentRegistry(buildGateways({}));
    expect(registry.require('paymob').provider).toBe('cash_on_delivery');
    expect(registry.require('cash_on_delivery').provider).toBe('cash_on_delivery');
  });

  it('orders the methods the way a shopper should see them', () => {
    const registry = new PaymentRegistry(
      buildGateways({
        PAYMOB_API_KEY: 'k',
        PAYMOB_CARD_INTEGRATION_ID: '1',
        PAYMOB_HMAC_SECRET: 'h',
        FAWRY_MERCHANT_CODE: 'M',
        FAWRY_SECURITY_KEY: 's',
        MANUAL_TRANSFER_ACCOUNT_NUMBER: '1',
      }),
    );
    expect(registry.list().map((gateway) => gateway.provider)).toEqual([
      'cash_on_delivery',
      'manual_transfer',
      'paymob',
      'fawry',
    ]);
  });

  it('recognises provider names, so a typo is not silently accepted', () => {
    expect(isPaymentProvider('paymob')).toBe(true);
    expect(isPaymentProvider('stripe')).toBe(false);
    const registry = new PaymentRegistry(buildGateways({}));
    expect(registry.get('stripe')).toBeNull();
  });

  it('every registered gateway is labelled in both languages', () => {
    const registry = new PaymentRegistry(
      buildGateways({
        PAYMOB_API_KEY: 'k',
        PAYMOB_CARD_INTEGRATION_ID: '1',
        PAYMOB_HMAC_SECRET: 'h',
        FAWRY_MERCHANT_CODE: 'M',
        FAWRY_SECURITY_KEY: 's',
        MANUAL_TRANSFER_ACCOUNT_NUMBER: '1',
      }),
    );
    for (const gateway of registry.list() as PaymentGateway[]) {
      expect(gateway.labelAr.length).toBeGreaterThan(0);
      expect(gateway.labelEn.length).toBeGreaterThan(0);
    }
  });
});
