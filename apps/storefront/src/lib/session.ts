/**
 * Cookie names shared by the storefront pages and its Server Actions.
 *
 * The customer session cookie is minted by `@velnorix/auth` (one cookie per
 * authentication context); the cart cookie is a random guest token minted by
 * the edge middleware, and only its SHA-256 is ever stored.
 */
export const CUSTOMER_SESSION_COOKIE = 'vx_customer_session';
export const CART_COOKIE = 'vx_cart';
