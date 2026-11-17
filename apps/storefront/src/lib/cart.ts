import { cookies } from 'next/headers';
import { money } from '@velnorix/core';
import {
  getCart,
  getOrCreateCustomerCart,
  getOrCreateGuestCart,
  withTenant,
  type CartWithLines,
} from '@velnorix/db';
import { CART_COOKIE } from './session.js';

/**
 * The cart for the current request.
 *
 * A signed-in customer's cart lives under their user id; everyone else gets a
 * guest cart keyed by a cookie token. Both are tenant-scoped rows, so a cart
 * can never contain another store's product -- RLS would refuse the insert.
 */

/**
 * The cart for the current request.
 *
 * The guest token is minted by the edge middleware, so it is always present by
 * the time a page renders; a Server Component cannot set cookies, and a cart
 * that only appears after the first add-to-cart is a cart that loses items.
 */
export async function currentCart(options: {
  storeId: string;
  currency: string;
  customerUserId: string | null;
}): Promise<CartWithLines> {
  const { storeId, currency, customerUserId } = options;
  const token = (await cookies()).get(CART_COOKIE)?.value ?? null;

  if (customerUserId) {
    return withTenant(storeId, async (db) => {
      const row = await getOrCreateCustomerCart(db, customerUserId, currency);
      return getCart(db, row);
    });
  }

  if (!token) return emptyCart(currency);

  return withTenant(storeId, async (db) => {
    const row = await getOrCreateGuestCart(db, token, currency);
    return getCart(db, row);
  });
}

/** A cart with no lines, used when there is nothing to load yet. */
function emptyCart(currency: string): CartWithLines {
  return {
    cart: {
      id: '',
      storeId: '',
      customerUserId: null,
      guestTokenHash: null,
      currency,
      status: 'active',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    lines: [],
    subtotal: money(0, currency),
    itemCount: 0,
  };
}

export const GUEST_CART_COOKIE = CART_COOKIE;
