'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  assertStrongPassword,
  authenticate,
  createPasswordResetToken,
  consumePasswordResetToken,
  endSession,
  hashPassword,
  registerCustomer,
  resolveSession,
  sessionAllowedOnHost,
  verifyCustomerEmail,
} from '@velnorix/auth';
import {
  claimGuestCart,
  findUserByEmail,
  updateUserPassword,
  withPlatform,
  withTenant,
} from '@velnorix/db';
import { CART_COOKIE } from '@/lib/session.js';
import { requireStorefront } from '@/lib/store-context.js';

/**
 * Customer account Server Actions.
 *
 * Registration never reveals whether an address is already taken: both cases
 * end on the same "check your inbox" screen, and the verification token is only
 * ever issued for a brand-new account.
 */

export type FormState = { error?: string; ok?: boolean; devToken?: string };

/** True only outside production: lets a developer confirm an email without a mail server. */
function devMailEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_TENANT_OVERRIDE === 'true';
}

export async function registerAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const fullName = String(formData.get('fullName') ?? '').trim();
  const { store, locale } = await requireStorefront();

  if (!email || !password || !fullName) {
    return { error: 'يرجى إدخال الاسم والبريد الإلكتروني وكلمة المرور.' };
  }

  const result = await withPlatform((db) =>
    registerCustomer(db, { storeId: store.id, email, password, fullName, locale }),
  );
  if (!result.ok) return { error: result.error.message };

  return {
    ok: true,
    // Shown on screen in development only; in production this goes out by email.
    ...(devMailEnabled() && result.value.verificationToken
      ? { devToken: result.value.verificationToken }
      : {}),
  };
}

export async function verifyEmailAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get('token') ?? '').trim();
  if (!token) return { error: 'يرجى إدخال رمز التأكيد.' };

  const result = await withPlatform((db) => verifyCustomerEmail(db, token));
  if (!result.ok) return { error: result.error.message };

  revalidatePath('/account/login');
  redirect('/account/login?verified=1');
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const { store } = await requireStorefront();

  if (!email || !password) {
    return { error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' };
  }

  const ipAddress = (await cookies()).get('x-forwarded-for')?.value ?? null;
  const outcome = await withPlatform((db) =>
    authenticate(db, {
      email,
      password,
      context: 'customer',
      storeId: store.id,
      ipAddress,
      userAgent: null,
    }),
  );

  if (outcome.status === 'failed') return { error: outcome.error.message };

  const cookieStore = await cookies();
  cookieStore.set('vx_customer_session', outcome.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });

  // Keep whatever was in the guest cart.
  const guestToken = cookieStore.get(CART_COOKIE)?.value;
  if (guestToken) {
    await withTenant(store.id, (db) => claimGuestCart(db, guestToken, outcome.user.id));
  }

  redirect('/account');
}

/**
 * Step one: ask for a reset.
 *
 * The response is **identical whether or not the address exists**. Telling the
 * customer "no such account" turns this form into a free membership oracle for
 * anyone who knows a few email addresses, and that is not a trade worth making
 * for a slightly friendlier message.
 *
 * A reset request also burns every outstanding token for that user, so a link
 * stolen from an old email cannot be used later.
 */
export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const { store } = await requireStorefront();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { error: 'يرجى إدخال بريد إلكتروني صحيح.' };
  }

  const token = await withPlatform(async (db) => {
    const user = await findUserByEmail(db, email, 'customer', store.id);
    // No account, or an account that never verified its email: same answer.
    if (!user || user.status !== 'active') return null;
    return createPasswordResetToken(db, user.id);
  });

  return {
    ok: true,
    ...(devMailEnabled() && token ? { devToken: token } : {}),
  };
}

/**
 * Step two: choose a new password.
 *
 * The token is consumed by the same statement that reads it, so the link works
 * exactly once — replaying it after a successful reset does nothing, and
 * replaying it while a reset is in flight cannot produce two winners.
 */
export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get('token') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('passwordConfirm') ?? '');

  if (!token) return { error: 'رابط الإعادة غير صالح أو منتهي الصلاحية.' };
  if (password !== confirm) return { error: 'كلمتا المرور غير متطابقتين.' };

  try {
    assertStrongPassword(password);
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'كلمة المرور ضعيفة.' };
  }

  const userId = await withPlatform((db) => consumePasswordResetToken(db, token));
  if (!userId) return { error: 'رابط الإعادة غير صالح أو منتهي الصلاحية.' };

  const passwordHash = await hashPassword(password);
  await withPlatform((db) => updateUserPassword(db, userId, passwordHash));

  revalidatePath('/account/login');
  redirect('/account/login?reset=1');
}

export async function logoutAction(): Promise<void> {
  const { store } = await requireStorefront();
  const cookieStore = await cookies();
  const token = cookieStore.get('vx_customer_session')?.value;

  if (token) {
    const session = await withPlatform((db) => resolveSession(db, token));
    if (
      session &&
      sessionAllowedOnHost('store', session.context, { matchesStore: session.storeId === store.id })
    ) {
      await withPlatform((db) => endSession(db, session.id, 'user_signout'));
    }
  }

  cookieStore.delete('vx_customer_session');
  redirect('/');
}
