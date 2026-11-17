'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import {
  authenticate,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  endSession,
  hasConfirmedTotp,
  verifySecondFactor,
} from '@velnorix/auth';
import { withPlatform } from '@velnorix/db';
import { clearSessionCookie, currentPrincipal, startSessionCookie } from '@/lib/session.js';
import { getRequestContext, resolveStoreId } from '@/lib/tenant.js';

/**
 * Authentication Server Actions.
 *
 * Each action validates its input, delegates to the auth service (which owns
 * rate limiting, lockout, MFA and the audit trail) and only then touches the
 * session cookie. A failed sign-in returns one generic message, so the form
 * never reveals whether an account exists.
 */

export type FormState = { error?: string; ok?: boolean; recoveryCodes?: string[] };

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const context = await getRequestContext();
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    return { error: 'يرجى إدخال البريد الإلكتروني وكلمة المرور.' };
  }

  const storeId = await resolveStoreId(context);
  const headerList = await headers();

  const outcome = await withPlatform((db) =>
    authenticate(db, {
      email,
      password,
      context: context.kind === 'platform' ? 'super_admin' : 'merchant_owner',
      storeId,
      ipAddress: headerList.get('x-forwarded-for'),
      userAgent: headerList.get('user-agent'),
    }),
  );

  if (outcome.status === 'failed') {
    return { error: outcome.error.message };
  }

  await startSessionCookie(outcome.session.context, outcome.token);

  if (outcome.status === 'mfa_required') {
    const enrolled = await withPlatform((db) => hasConfirmedTotp(db, outcome.user.id));
    redirect(enrolled ? '/mfa' : '/mfa/setup');
  }

  redirect('/');
}

/** Verifies the second factor for a session that is still pending MFA. */
export async function verifyMfaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'يرجى إدخال الرمز المكوّن من 6 أرقام.' };

  const current = await currentPrincipal();
  if (!current) redirect('/login');

  const result = await withPlatform((db) =>
    verifySecondFactor(db, {
      sessionId: current.sessionId,
      userId: current.principal.userId,
      code,
    }),
  );

  if (!result.ok) return { error: result.error.message };
  redirect('/');
}

/**
 * Starts TOTP enrolment and returns the seed, the otpauth URI and a QR code
 * rendered server-side as SVG (so no QR library is shipped to the browser).
 */
export async function enrollTotpAction(): Promise<{ secret: string; uri: string; qr: string }> {
  const current = await currentPrincipal();
  if (!current) redirect('/login');

  const setup = await withPlatform((db) =>
    beginTotpEnrollment(db, current.principal.userId, current.principal.email),
  );
  const qr = await QRCode.toString(setup.uri, {
    type: 'svg',
    margin: 0,
    errorCorrectionLevel: 'M',
  });
  return { ...setup, qr };
}

/** Confirms enrolment with a code and issues recovery codes. */
export async function confirmTotpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const current = await currentPrincipal();
  if (!current) redirect('/login');

  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'يرجى إدخال الرمز الظاهر في التطبيق.' };

  const result = await withPlatform((db) =>
    confirmTotpEnrollment(db, current.principal.userId, code),
  );
  if (!result.ok) return { error: result.error.message };

  return { ok: true, recoveryCodes: result.value.recoveryCodes };
}

export async function signOutAction(): Promise<void> {
  const current = await currentPrincipal();
  if (current) {
    await withPlatform((db) => endSession(db, current.sessionId, 'user_signout'));
    await clearSessionCookie(current.principal.context);
  }
  redirect('/login');
}
