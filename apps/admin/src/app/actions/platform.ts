'use server';

import { revalidatePath } from 'next/cache';
import { AuthorizationError } from '@velnorix/core';
import { PERMISSION, assertCan } from '@velnorix/auth';
import { recordAudit, restoreStore, suspendStore, withPlatform } from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Platform Server Actions.
 *
 * Every action re-checks the permission on the server (the UI hiding a button
 * is not access control) and writes an audit entry, including the one taken
 * when a permission is missing.
 */

export type ActionState = { ok?: boolean; error?: string };

export async function suspendStoreAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const storeId = String(formData.get('storeId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim() || 'بدون سبب مُسجّل';
  if (!storeId) return { error: 'معرّف المتجر غير صالح.' };

  const { principal } = await requirePrincipal(['super_admin', 'platform_staff']);

  try {
    assertCan(principal, PERMISSION.PLATFORM_TENANTS_SUSPEND);
  } catch (error) {
    await withPlatform((db) =>
      recordAudit(db, {
        actorType: 'user',
        actorUserId: principal.userId,
        actorContext: principal.context,
        storeId,
        action: 'platform.store.suspend_denied',
        targetType: 'store',
        targetId: storeId,
      }),
    );
    return { error: error instanceof AuthorizationError ? error.message : 'غير مسموح.' };
  }

  await withPlatform(async (db) => {
    await suspendStore(db, storeId, reason);
    await recordAudit(db, {
      actorType: 'user',
      actorUserId: principal.userId,
      actorContext: principal.context,
      storeId,
      action: 'platform.store.suspended',
      targetType: 'store',
      targetId: storeId,
      metadata: { reason },
    });
  });

  revalidatePath('/stores');
  return { ok: true };
}

export async function restoreStoreAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const storeId = String(formData.get('storeId') ?? '');
  if (!storeId) return { error: 'معرّف المتجر غير صالح.' };

  const { principal } = await requirePrincipal(['super_admin', 'platform_staff']);
  try {
    assertCan(principal, PERMISSION.PLATFORM_TENANTS_SUSPEND);
  } catch (error) {
    return { error: error instanceof AuthorizationError ? error.message : 'غير مسموح.' };
  }

  await withPlatform(async (db) => {
    await restoreStore(db, storeId);
    await recordAudit(db, {
      actorType: 'user',
      actorUserId: principal.userId,
      actorContext: principal.context,
      storeId,
      action: 'platform.store.restored',
      targetType: 'store',
      targetId: storeId,
    });
  });

  revalidatePath('/stores');
  return { ok: true };
}
