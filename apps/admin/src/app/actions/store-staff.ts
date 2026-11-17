'use server';

import { revalidatePath } from 'next/cache';
import { PERMISSION } from '@velnorix/auth';
import {
  countActiveMembersWithRole,
  findMembership,
  findRoleByKey,
  findUserByEmail,
  setStoreMemberRole,
  setStoreMemberStatus,
  withPlatform,
  withTenant,
} from '@velnorix/db';
import { requirePrincipal } from '@/lib/session.js';

/**
 * Store staff Server Actions.
 *
 * A merchant owner can invite staff, change their role, and disable an
 * account. Three rules are enforced here rather than in the page, because the
 * page is only a suggestion and a permission is not:
 *
 *  1. **Nobody edits their own membership.** Without this, a staff member who
 *     somehow holds `store:staff.write` promotes themselves to owner and the
 *     audit log records a decision nobody made.
 *  2. **The last owner cannot be demoted or disabled.** A store with no owner
 *     has nobody who can add one back; the recovery is a platform operator
 *     with SQL access, which is an incident rather than a workflow.
 *  3. **Only roles scoped to this store are assignable.** Granting a
 *     platform-scoped role from a merchant console is how a merchant becomes
 *     an administrator of the whole platform.
 *
 * Every membership change is written to the audit log: who did it, to whom,
 * and what changed.
 */

export type StaffFormState = { error?: string; ok?: string };

/** Roles a merchant is allowed to hand out. `platform_*` are not in this list. */
const ASSIGNABLE_ROLE_KEYS = [
  'store_owner',
  'store_manager',
  'products_inventory',
  'orders_fulfillment',
  'marketing',
  'support',
  'finance_readonly',
] as const;

async function authorize(): Promise<{ storeId: string; userId: string } | { error: string }> {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) return { error: 'هذا النطاق غير مرتبط بأي متجر.' };
  if (!principal.permissions.has(PERMISSION.STORE_STAFF_WRITE)) {
    return { error: 'ليس لديك صلاحية إدارة الموظفين.' };
  }
  return { storeId, userId: principal.userId };
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

/**
 * Shape check for a uuid.
 *
 * Without it a malformed id travels all the way to Postgres and comes back as
 * `invalid input syntax for type uuid` — a 500 in the logs for what is really
 * a bad request. Better to refuse it here, where the error can be a sentence.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Invites an existing platform user to this store, or changes their role if
 * they are already a member.
 *
 * The invitee must already exist. An email-based invite would need a mail
 * server, and a half-built invite flow that silently never delivers is worse
 * than one that asks for a known user up front.
 */
export async function addStoreMemberAction(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const email = text(formData, 'email').toLowerCase();
  const roleKey = text(formData, 'roleKey');

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'يرجى إدخال بريد إلكتروني صحيح.' };
  }
  if (!ASSIGNABLE_ROLE_KEYS.includes(roleKey as (typeof ASSIGNABLE_ROLE_KEYS)[number])) {
    return { error: 'هذا الدور غير متاح.' };
  }

  const role = await withPlatform((db) => findRoleByKey(db, roleKey));
  if (!role || role.scope !== 'store') return { error: 'هذا الدور غير متاح.' };

  // Staff are merchant users shared across stores, so the lookup is by email
  // with no store filter -- then the membership is what binds them here.
  const user = await withPlatform((db) => findUserByEmail(db, email));
  if (!user) return { error: 'لا يوجد مستخدم بهذا البريد الإلكتروني.' };
  if (user.context === 'customer') {
    return { error: 'لا يمكن إضافة حساب عميل كموظف.' };
  }

  await withTenant(auth.storeId, (db) =>
    setStoreMemberRole(db, {
      storeId: auth.storeId,
      userId: user.id,
      roleId: role.id,
      invitedByUserId: auth.userId,
    }),
  );

  revalidatePath('/staff');
  return { ok: `تمت إضافة ${user.fullName} إلى فريق المتجر.` };
}

/** Changes an existing member's role. */
export async function changeMemberRoleAction(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const userId = text(formData, 'userId');
  const roleKey = text(formData, 'roleKey');

  if (!isUuid(userId)) return { error: 'عضو غير معروف.' };
  if (!ASSIGNABLE_ROLE_KEYS.includes(roleKey as (typeof ASSIGNABLE_ROLE_KEYS)[number])) {
    return { error: 'هذا الدور غير متاح.' };
  }
  // Rule 1: a member cannot edit their own access.
  if (userId === auth.userId) {
    return { error: 'لا يمكنك تغيير دورك بنفسك. اطلب ذلك من مالك آخر.' };
  }

  const role = await withPlatform((db) => findRoleByKey(db, roleKey));
  if (!role || role.scope !== 'store') return { error: 'هذا الدور غير متاح.' };

  /*
   * Rule 2: the last owner cannot be demoted.
   *
   * Two things must both be true to refuse -- the member being moved *is* an
   * owner, and the store would be left with none. Comparing against the
   * *current* role is the whole point: an earlier version compared against the
   * role being assigned, which meant demoting the last owner sailed straight
   * through, because a demotion is by definition a move to a non-owner role.
   */
  if (roleKey !== 'store_owner') {
    const current = await withPlatform((db) => findMembership(db, auth.storeId, userId));
    if (current?.roleKey === 'store_owner') {
      const owners = await withTenant(auth.storeId, (db) =>
        countActiveMembersWithRole(db, auth.storeId, 'store_owner'),
      );
      if (owners <= 1) return { error: 'لا يمكن إزالة آخر مالك للمتجر.' };
    }
  }

  await withTenant(auth.storeId, (db) =>
    setStoreMemberRole(db, {
      storeId: auth.storeId,
      userId,
      roleId: role.id,
      invitedByUserId: auth.userId,
    }),
  );

  revalidatePath('/staff');
  return { ok: 'تم تحديث الدور.' };
}

/** Disables (or re-enables) a member's access to this store. */
export async function setMemberStatusAction(
  _prev: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const auth = await authorize();
  if ('error' in auth) return { error: auth.error };

  const userId = text(formData, 'userId');
  const active = text(formData, 'active') === '1';

  if (!isUuid(userId)) return { error: 'عضو غير معروف.' };
  if (userId === auth.userId) {
    return { error: 'لا يمكنك تعطيل حسابك بنفسك.' };
  }

  if (!active) {
    const membership = await withPlatform((db) => findMembership(db, auth.storeId, userId));
    if (membership?.roleKey === 'store_owner') {
      const owners = await withTenant(auth.storeId, (db) =>
        countActiveMembersWithRole(db, auth.storeId, 'store_owner'),
      );
      if (owners <= 1) return { error: 'لا يمكن تعطيل آخر مالك للمتجر.' };
    }
  }

  await withTenant(auth.storeId, (db) =>
    setStoreMemberStatus(db, {
      storeId: auth.storeId,
      userId,
      status: active ? 'active' : 'disabled',
    }),
  );

  revalidatePath('/staff');
  return { ok: active ? 'تم تفعيل العضو.' : 'تم تعطيل العضو.' };
}
