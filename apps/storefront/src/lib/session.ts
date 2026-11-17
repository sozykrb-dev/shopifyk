/**
 * Cookie names shared by the storefront pages and its Server Actions.
 *
 * The customer session cookie is minted by `@velnorix/auth` (one cookie per
 * authentication context). The cart cookie is a random guest token minted by
 * the edge middleware, and only its SHA-256 is ever stored. The last-order
 * cookie is the only way back to a confirmation page, so an order cannot be
 * read by guessing its number.
 */
export const CUSTOMER_SESSION_COOKIE = 'vx_customer_session';
export const CART_COOKIE = 'vx_cart';
export const LAST_ORDER_COOKIE = 'vx_last_order';
