'use server';

import { revalidatePath } from 'next/cache';
import { InsufficientStockError, randomToken } from '@velnorix/core';
import {
  addCartItem,
  claimGuestCart,
  getOrCreateCustomerCart,
  getOrCreateGuestCart,
  getProductById,
  listProductVariants,
  removeCartItem,
  setCartItemQuantity,
  withTenant,
} from '@velnorix/db';
import { cookies } from 'next/headers';
import { CART_COOKIE } from '@/lib/session.js';
import { requireStorefront } from '@/lib/store-context.js';

/**
 * Cart Server Actions.
 *
 * Every action re-resolves the store from the Host header (never from the
 * client) and reads prices from the database: a price posted by the browser is
 * not a price, it is an attack.
 */

async function cartIdForCheckout(): Promise<string> {
  const { store, currency, customerUserId } = await requireStorefront();
  const cookieStore = await cookies();

  if (customerUserId) {
    return withTenant(store.id, async (db) => {
      const cart = await getOrCreateCustomerCart(db, customerUserId, currency);
      const guestToken = cookieStore.get(CART_COOKIE)?.value;
      // Signing in must not empty the cart that was filled as a guest.
      if (guestToken) await claimGuestCart(db, guestToken, customerUserId);
      return cart.id;
    });
  }

  const token = cookieStore.get(CART_COOKIE)?.value ?? randomToken(32);
  const cartId = await withTenant(store.id, async (db) => {
    const cart = await getOrCreateGuestCart(db, token, currency);
    return cart.id;
  });
  cookieStore.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return cartId;
}

export type CartState = { error?: string; ok?: string };

export async function addToCartAction(_prev: CartState, formData: FormData): Promise<CartState> {
  const productId = String(formData.get('productId') ?? '');
  const variantIdRaw = String(formData.get('variantId') ?? '');
  const variantId = variantIdRaw || null;
  const quantity = Number(formData.get('quantity') ?? 1);
  const { store, currency } = await requireStorefront();
  const cartId = await cartIdForCheckout();

  await withTenant(store.id, async (db) => {
    const product = await getProductById(db, productId);
    if (!product || product.status !== 'active') return;

    let unitPriceMinor = product.priceMinor;
    if (variantId) {
      const variants = await listProductVariants(db, productId);
      const variant = variants.find((candidate) => candidate.id === variantId);
      // A variant from another product is simply ignored, not trusted.
      if (!variant) return;
      unitPriceMinor = variant.priceMinor;
    }

    try {
      await addCartItem(db, {
        cartId,
        productId,
        variantId,
        quantity,
        unitPriceMinor,
        currency: variantId ? currency : product.currency,
      });
    } catch (error) {
      /*
       * Stock ran out between the page being rendered and the button being
       * pressed. The product page already shows what is left, so this is a
       * race rather than the normal path -- but it must come back as a
       * sentence, not as a 500.
       */
      if (error instanceof InsufficientStockError) {
        return { error: 'نفد مخزون هذا المنتج.' };
      }
      throw error;
    }
  });

  revalidatePath('/cart');
  revalidatePath('/');
  return { ok: 'تمت الإضافة إلى السلة.' };
}

export async function updateCartItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '');
  const quantity = Number(formData.get('quantity') ?? 0);
  const { store } = await requireStorefront();

  await withTenant(store.id, (db) => setCartItemQuantity(db, itemId, quantity));
  revalidatePath('/cart');
}

export async function removeCartItemAction(formData: FormData): Promise<void> {
  const itemId = String(formData.get('itemId') ?? '');
  const { store } = await requireStorefront();

  await withTenant(store.id, (db) => removeCartItem(db, itemId));
  revalidatePath('/cart');
}
