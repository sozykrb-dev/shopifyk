'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { money } from '@velnorix/core';
import { paymentRegistry } from '@velnorix/payments';
import { priceCart, rejectionMessage, type PriceableLine } from '@velnorix/pricing';
import {
  createPaymentIntent,
  setPaymentIntentStatus,
  getCart,
  getOrCreateCustomerCart,
  getOrCreateGuestCart,
  placeOrder,
  pricingInputs,
  redeemCoupon,
  withTenant,
} from '@velnorix/db';
import { CART_COOKIE, LAST_ORDER_COOKIE } from '@/lib/session.js';
import { requireStorefront } from '@/lib/store-context.js';

/** The origin a gateway should send the shopper back to. */
async function originFor(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost';
  const proto = headerList.get('x-forwarded-proto') ?? 'https';
  return `${proto}://${host}`;
}

/**
 * Checkout.
 *
 * The browser sends a name, a phone number and an address, and nothing else:
 * every line and every price is read from the cart rows inside `withTenant()`.
 * A total posted by a form is not a total.
 */

export type CheckoutState = { error?: string };

function clean(value: FormDataEntryValue | null): string {
  return String(value ?? '').trim();
}

export async function placeOrderAction(
  _prev: CheckoutState,
  formData: FormData,
): Promise<CheckoutState> {
  const { store, currency, customerUserId } = await requireStorefront();

  const email = clean(formData.get('email'));
  const shippingName = clean(formData.get('shippingName'));
  const addressLine1 = clean(formData.get('addressLine1'));
  const city = clean(formData.get('city'));

  // Checked here rather than trusting `required` on the inputs: a form
  // attribute is a nicety for the browser, not a control.
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'أدخل بريدًا إلكترونيًا صحيحًا.' };
  }
  if (!shippingName) return { error: 'أدخل اسم المستلم.' };
  if (!addressLine1) return { error: 'أدخل عنوان الشحن.' };
  if (!city) return { error: 'أدخل المدينة.' };

  const cookieStore = await cookies();
  const guestToken = cookieStore.get(CART_COOKIE)?.value ?? null;
  if (!customerUserId && !guestToken) {
    return { error: 'انتهت صلاحية السلة. أعد إضافة المنتجات.' };
  }

  const cart = await withTenant(store.id, (db) =>
    customerUserId
      ? getOrCreateCustomerCart(db, customerUserId, currency)
      : getOrCreateGuestCart(db, guestToken!, currency),
  );

  // The same cart was already spent -- almost always a double submit.
  if (cart.status === 'converted') {
    return { error: 'تم تسجيل هذا الطلب بالفعل.' };
  }

  const { lines } = await withTenant(store.id, (db) => getCart(db, cart));
  if (lines.length === 0) return { error: 'السلة فارغة.' };

  const countryCode = clean(formData.get('countryCode')) || 'EG';
  const region = clean(formData.get('region')) || null;
  const couponCode = clean(formData.get('couponCode'));

  /*
   * The order is priced here, on the server, from the cart rows and the
   * store's own rules -- not from anything the browser posted. A total that
   * arrives in a form field is a total a customer can edit, so the form sends
   * an address and a coupon code and nothing else.
   */
  const quote = await withTenant(store.id, async (db) => {
    const inputs = await pricingInputs(db, {
      storeId: store.id,
      code: couponCode || null,
      email,
    });
    return {
      quote: priceCart({
        lines: lines.map<PriceableLine>((line) => ({
          id: line.id,
          unitAmount: money(line.unitPriceMinor, cart.currency),
          quantity: line.quantity,
        })),
        currency: cart.currency,
        destination: { countryCode, region, city },
        taxRules: inputs.taxRules,
        shippingRates: inputs.shippingRates,
        coupon: inputs.coupon,
      }),
      couponRowId: inputs.couponRow?.id ?? null,
    };
  });

  /*
   * A coupon that does not apply stops the order rather than quietly charging
   * full price. Silently ignoring it is how a customer discovers at the door
   * that the discount they came for was never honoured.
   */
  const outcome = quote.quote.coupon;
  if (couponCode && outcome && !outcome.accepted && outcome.rejection) {
    return { error: rejectionMessage(outcome.rejection) };
  }
  if (couponCode && !outcome) return { error: rejectionMessage('not_found') };

  const paymentMethod = clean(formData.get('paymentMethod')) || 'cash_on_delivery';
  const registry = paymentRegistry();
  const gateway = registry.require(paymentMethod);

  let orderNumber: number;
  let orderId: string;
  try {
    const order = await withTenant(store.id, (db) =>
      placeOrder(
        db,
        {
          cartId: cart.id,
          customerUserId,
          currency: cart.currency,
          email,
          phone: clean(formData.get('phone')) || null,
          shippingName,
          addressLine1,
          addressLine2: clean(formData.get('addressLine2')) || null,
          city,
          region: clean(formData.get('region')) || null,
          countryCode: clean(formData.get('countryCode')) || 'EG',
          notes: clean(formData.get('notes')) || null,
          paymentMethod: gateway.provider,
          shippingMinor: quote.quote.shippingAmount.amount,
          discountMinor: quote.quote.discount.amount,
          taxMinor: quote.quote.tax.amount,
          /*
           * The engine has already priced this order, inclusive or exclusive
           * of tax. Recomputing the total here would disagree with it -- most
           * visibly when a shelf price already contains VAT.
           */
          totalMinor: quote.quote.total.amount,
        },
        lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          titleAr: line.titleAr,
          titleEn: line.titleEn,
          variantTitleAr: line.variantTitleAr,
          variantTitleEn: line.variantTitleEn,
          sku: line.sku,
          quantity: line.quantity,
          unitPriceMinor: line.unitPriceMinor,
        })),
      ),
    );
    orderNumber = order.orderNumber;
    orderId = order.id;

    const intent = await withTenant(store.id, (db) =>
      createPaymentIntent(db, {
        orderId: order.id,
        provider: gateway.provider,
        amount: money(order.totalMinor, order.currency),
      }),
    );

    /*
     * The gateway is asked for a payment *after* the order exists, so there is
     * always a row of ours to hang the provider's reference on -- and so an
     * order never silently has no payment behind it. The amount comes from the
     * order, never from the browser (and never from the webhook later).
     */
    const payment = await gateway
      .createPayment({
        intentId: intent.id,
        orderNumber: order.orderNumber,
        amount: money(order.totalMinor, order.currency),
        customer: {
          email,
          phone: clean(formData.get('phone')) || undefined,
          name: shippingName,
        },
        returnUrl: `${originFor()}/checkout/confirm?order=${order.orderNumber}`,
      })
      .catch(() => null);

    if (payment) {
      await withTenant(store.id, (db) =>
        setPaymentIntentStatus(db, intent.id, payment.status, {
          providerReference: payment.providerReference,
        }),
      );
    }

    /*
     * The redemption is written after the order exists, and is idempotent by
     * (coupon, order): a usage cap counted from these rows cannot be spent
     * twice by replaying checkout.
     */
    if (quote.couponRowId && quote.quote.discount.amount > 0) {
      await withTenant(store.id, (db) =>
        redeemCoupon(db, {
          storeId: store.id,
          couponId: quote.couponRowId!,
          orderId,
          email,
          amount: {
            amount: quote.quote.discount.amount,
            currency: cart.currency,
          },
        }),
      );
    }
  } catch (error) {
    // Re-submitting hits the unique index on (store_id, cart_id): one cart can
    // only ever become one order.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('duplicate key') || message.includes('orders_cart_key')) {
      return { error: 'تم تسجيل هذا الطلب بالفعل.' };
    }
    throw error;
  }

  /*
   * The confirmation page is reached through this cookie, not through a URL
   * anyone can guess: order numbers are sequential, so
   * `/checkout/confirm?order=1002` would otherwise be a readable list of other
   * people's names and addresses.
   */
  cookieStore.set(LAST_ORDER_COOKIE, orderId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 2,
  });
  // The cart is spent; the visitor gets a fresh one on the next page.
  cookieStore.delete(CART_COOKIE);

  revalidatePath('/cart');
  redirect(`/checkout/confirm?order=${orderNumber}`);
}
