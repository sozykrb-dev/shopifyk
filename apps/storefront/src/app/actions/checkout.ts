'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  getCart,
  getOrCreateCustomerCart,
  getOrCreateGuestCart,
  placeOrder,
  withTenant,
} from '@velnorix/db';
import { CART_COOKIE, LAST_ORDER_COOKIE } from '@/lib/session.js';
import { requireStorefront } from '@/lib/store-context.js';

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
          paymentMethod: 'cash_on_delivery',
          shippingMinor: 0,
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
