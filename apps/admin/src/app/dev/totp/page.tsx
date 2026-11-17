import { notFound } from 'next/navigation';
import { Alert, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@velnorix/ui';
import { TotpCode } from './totp-code.js';
import { currentSeedTotpCode, secondsUntilNextCode } from './totp.js';

/**
 * Development helper: the live TOTP code for the seeded demo account.
 *
 * A 6-digit code that changes every 30 seconds is miserable to copy out of a
 * terminal, so in development it is rendered here instead. The page is a 404
 * unless every one of these holds:
 *
 *   NODE_ENV !== 'production'
 *   ALLOW_DEV_TENANT_OVERRIDE === 'true'   (the same switch that enables ?__tenant=)
 *   SEED_TOTP_SECRET is set                (only the seed script puts it there)
 *
 * In production it does not exist. Command-line equivalent: `pnpm totp`.
 */
export const dynamic = 'force-dynamic';

export const metadata = { title: 'رمز التحقق (تطوير)' };

export default function DevTotpPage() {
  const enabled =
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_DEV_TENANT_OVERRIDE === 'true' &&
    Boolean(process.env.SEED_TOTP_SECRET);
  if (!enabled) notFound();

  const email = process.env.DEV_TOTP_EMAIL ?? 'owner@velnorix.test';

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>رمز التحقق — بيئة تطوير</CardTitle>
          <CardDescription>
            رمز الحساب التجريبي <span className="numeric">{email}</span>. هذه الصفحة تعمل في التطوير
            فقط ولا وجود لها في الإنتاج.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1 text-center">
            <p className="text-4xl font-semibold tracking-[0.3em] numeric">
              {currentSeedTotpCode()}
            </p>
            <TotpCode initialSecondsLeft={secondsUntilNextCode()} />
          </div>
          <Alert tone="warning" title="للتطوير فقط">
            السرّ ثابت في <code className="numeric">SEED_TOTP_SECRET</code> لتسهيل التجربة. في
            الإنتاج كل حساب يولّد سرّه الخاص مشفّرًا في قاعدة البيانات.
          </Alert>
        </CardContent>
      </Card>
    </main>
  );
}
