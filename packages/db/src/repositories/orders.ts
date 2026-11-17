import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { money } from '@velnorix/core';
import { buildPage, InsufficientStockError, type Money, type Page } from '@velnorix/core';
import type { Database } from '../client.js';
import { requireTenantId } from '../tenant-context.js';
import { reserveStock } from './products.js';
import {
  carts,
  orderItems,
  orders,
  type NewOrder,
  type NewOrderItem,
  type Order,
  type OrderItem,
} from '../schema.js';

/**
 * Orders (tenant table).
 *
 * An order is a snapshot, never a live view: the customer's name, address and
 * every line's price are copied here at checkout. Deleting a product or
 * renaming a variant afterwards must not re-write history -- an order is a
 * promise about what was bought and for how much.
 */

export type OrderTotals = {
  subtotal: number;
  shipping: number;
  discount: number;
  tax: number;
  total: number;
};

export type PlaceOrderInput = {
  cartId: string;
  customerUserId: string | null;
  currency: string;
  email: string;
  phone?: string | null;
  shippingName: string;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  region?: string | null;
  countryCode?: string;
  notes?: string | null;
  paymentMethod?: string;
  shippingMinor?: number;
  discountMinor?: number;
  taxMinor?: number;
  /**
   * The total as the pricing engine computed it.
   *
   * When a shelf price already contains VAT, the total is *not* subtotal +
   * tax + shipping - discount, because the tax is inside the price. Callers
   * that have run `packages/pricing` pass its answer rather than asking this
   * function to add the columns up a second time.
   */
  totalMinor?: number;
};

export type OrderLineSnapshot = {
  productId: string | null;
  variantId: string | null;
  titleAr: string;
  titleEn: string;
  variantTitleAr: string | null;
  variantTitleEn: string | null;
  sku: string | null;
  quantity: number;
  unitPriceMinor: number;
};

export type OrderWithLines = {
  order: Order;
  items: OrderItem[];
  total: Money;
};

/**
 * Places an order from a cart, in one transaction.
 *
 * Everything that can go wrong here must leave no trace: the order number, the
 * lines and the cart status all commit together or not at all. Re-submitting
 * the checkout form is caught by the unique index on (store_id, cart_id), so a
 * double click cannot produce two orders for one cart.
 */
export async function placeOrder(
  db: Database,
  input: PlaceOrderInput,
  lines: readonly OrderLineSnapshot[],
): Promise<Order> {
  const storeId = requireTenantId();

  if (lines.length === 0) {
    throw new Error('Cannot place an order with no lines.');
  }

  return db.transaction(async (tx) => {
    // `next_order_number` reserves the next number inside the same
    // transaction, so two concurrent checkouts cannot be handed 1001 twice.
    const [numbered] = await tx
      .select({
        orderNumber: sql<number>`(
          SELECT COALESCE(MAX(order_number), 1000) + 1
          FROM ${orders}
          WHERE store_id = ${storeId}
        )`.as('order_number'),
      })
      .from(sql`(SELECT 1) AS t`);

    const shippingMinor = Math.max(0, Math.trunc(input.shippingMinor ?? 0));
    const discountMinor = Math.max(0, Math.trunc(input.discountMinor ?? 0));
    const taxMinor = Math.max(0, Math.trunc(input.taxMinor ?? 0));
    const subtotalMinor = lines.reduce(
      (total, line) => total + line.unitPriceMinor * line.quantity,
      0,
    );
    const totalMinor =
      input.totalMinor !== undefined
        ? Math.max(0, Math.trunc(input.totalMinor))
        : Math.max(0, subtotalMinor + shippingMinor + taxMinor - discountMinor);

    const values: NewOrder = {
      storeId,
      orderNumber: numbered?.orderNumber ?? 1001,
      customerUserId: input.customerUserId,
      cartId: input.cartId,
      email: input.email,
      phone: input.phone ?? null,
      shippingName: input.shippingName,
      addressLine1: input.addressLine1,
      addressLine2: input.addressLine2 ?? null,
      city: input.city,
      region: input.region ?? null,
      countryCode: input.countryCode ?? 'EG',
      notes: input.notes ?? null,
      currency: input.currency,
      subtotalMinor,
      shippingMinor,
      discountMinor,
      taxMinor,
      totalMinor,
      paymentMethod: input.paymentMethod ?? 'cash_on_delivery',
      status: 'pending',
      paymentStatus: 'unpaid',
      fulfillmentStatus: 'unfulfilled',
    };

    const [order] = await tx.insert(orders).values(values).returning();
    if (!order) throw new Error('Order insert returned nothing.');

    const itemValues: NewOrderItem[] = lines.map((line) => ({
      storeId,
      orderId: order.id,
      productId: line.productId,
      variantId: line.variantId,
      titleAr: line.titleAr,
      titleEn: line.titleEn,
      variantTitleAr: line.variantTitleAr,
      variantTitleEn: line.variantTitleEn,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.unitPriceMinor * line.quantity,
      currency: input.currency,
    }));
    await tx.insert(orderItems).values(itemValues);

    /*
     * Stock is taken here, inside the order's own transaction, so an order
     * that cannot be fulfilled cannot be placed at all. Reserving before the
     * insert would let a payment failure leave stock gone with no order to
     * show for it; reserving after the commit would let two customers buy the
     * last item at once.
     */
    const oversold = await reserveStock(
      tx,
      lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    );
    if (oversold.length > 0) {
      // Throwing rolls the whole transaction back: no order, no items, no
      // spent cart, and no stock taken.
      throw new InsufficientStockError(oversold);
    }

    // The cart is spent. Leaving it active would let the same cart be checked
    // out again (or show stale lines on the next page load).
    await tx
      .update(carts)
      .set({ status: 'converted', updatedAt: new Date() })
      .where(and(eq(carts.storeId, storeId), eq(carts.id, input.cartId)));

    return order;
  });
}

export async function getOrderById(db: Database, orderId: string): Promise<OrderWithLines | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, requireTenantId()), eq(orders.id, orderId)))
    .limit(1);
  if (!order) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.storeId, requireTenantId()), eq(orderItems.orderId, orderId)))
    .orderBy(asc(orderItems.createdAt));

  return { order, items, total: money(order.totalMinor, order.currency) };
}

export async function getOrderByNumber(
  db: Database,
  orderNumber: number,
): Promise<OrderWithLines | null> {
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, requireTenantId()), eq(orders.orderNumber, orderNumber)))
    .limit(1);
  if (!order) return null;
  return getOrderById(db, order.id);
}

export type ListOrdersFilter = {
  limit: number;
  cursor?: string | undefined;
  status?: Order['status'] | undefined;
  search?: string | undefined;
};

export async function listOrders(db: Database, filter: ListOrdersFilter): Promise<Page<Order>> {
  const conditions = [eq(orders.storeId, requireTenantId())];
  if (filter.status) conditions.push(eq(orders.status, filter.status));
  if (filter.search) {
    const term = `%${filter.search}%`;
    conditions.push(
      sql`(${orders.email} ILIKE ${term} OR ${orders.shippingName} ILIKE ${term} OR ${orders.city} ILIKE ${term} OR CAST(${orders.orderNumber} AS TEXT) ILIKE ${term})`,
    );
  }

  const rows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.placedAt), desc(orders.id))
    .limit(filter.limit + 1);

  return buildPage(rows.slice(0, filter.limit), filter.limit, (order) => ({
    k: order.placedAt.toISOString(),
    i: order.id,
  }));
}

/** Orders belonging to one customer, newest first. */
export async function listCustomerOrders(
  db: Database,
  customerUserId: string,
  limit = 20,
): Promise<Order[]> {
  return db
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, requireTenantId()), eq(orders.customerUserId, customerUserId)))
    .orderBy(desc(orders.placedAt))
    .limit(limit);
}

export async function countOrders(db: Database): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(orders)
    .where(eq(orders.storeId, requireTenantId()));
  return row?.value ?? 0;
}

/** Revenue over settled orders, for the store dashboard. */
export async function revenueTotals(db: Database): Promise<{
  paidMinor: number;
  currency: string;
  orderCount: number;
}> {
  const [row] = await db
    .select({
      paid: sql<number>`COALESCE(SUM(total_minor) FILTER (WHERE payment_status = 'paid'), 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(orders)
    .where(eq(orders.storeId, requireTenantId()));

  return { paidMinor: row?.paid ?? 0, currency: 'EGP', orderCount: row?.count ?? 0 };
}

export async function updateOrderStatus(
  db: Database,
  orderId: string,
  status: Order['status'],
): Promise<Order | null> {
  const [updated] = await db
    .update(orders)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(orders.storeId, requireTenantId()), eq(orders.id, orderId)))
    .returning();
  return updated ?? null;
}

export async function markOrderPaid(
  db: Database,
  orderId: string,
  paymentReference?: string | null,
): Promise<Order | null> {
  const [updated] = await db
    .update(orders)
    .set({
      paymentStatus: 'paid',
      paymentReference: paymentReference ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(orders.storeId, requireTenantId()), eq(orders.id, orderId)))
    .returning();
  return updated ?? null;
}
