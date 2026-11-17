'use server';

import { revalidatePath } from 'next/cache';
import { PERMISSION } from '@velnorix/auth';
import { getOrderById, markOrderPaid, updateOrderStatus, withTenant } from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Order actions.
 *
 * Moving an order to "delivered" is a real-world claim about money and goods,
 * so it is a separate permission from merely reading orders, and every action
 * re-checks it here rather than trusting the button that posted the form.
 */

const STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;

function parseStatus(value: FormDataEntryValue | null): (typeof STATUSES)[number] | null {
  const status = String(value ?? '');
  return (STATUSES as readonly string[]).includes(status)
    ? (status as (typeof STATUSES)[number])
    : null;
}

export async function updateOrderStatusAction(formData: FormData): Promise<void> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  const orderId = String(formData.get('orderId') ?? '');
  const status = parseStatus(formData.get('status'));

  if (!storeId || !status || !principal.permissions.has(PERMISSION.STORE_ORDERS_WRITE)) {
    revalidatePath(`/orders/${orderId}`);
    return;
  }

  const order = await withTenant(storeId, (db) => getOrderById(db, orderId));
  if (!order) return;

  await withTenant(storeId, (db) => updateOrderStatus(db, orderId, status));
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
}

export async function markOrderPaidAction(formData: FormData): Promise<void> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  const orderId = String(formData.get('orderId') ?? '');
  const reference = String(formData.get('reference') ?? '').trim() || null;

  if (!storeId || !principal.permissions.has(PERMISSION.STORE_ORDERS_REFUND)) {
    revalidatePath(`/orders/${orderId}`);
    return;
  }

  const order = await withTenant(storeId, (db) => getOrderById(db, orderId));
  if (!order) return;

  await withTenant(storeId, (db) => markOrderPaid(db, orderId, reference));
  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
}
