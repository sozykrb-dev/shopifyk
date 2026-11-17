'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { Alert, Badge, Button, Card, Input, Label, Separator } from '@velnorix/ui';
import { confirmTotpAction, enrollTotpAction, type FormState } from '@/app/actions/auth.js';

type Enrollment = { secret: string; uri: string; qr: string };

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      تأكيد وتفعيل
    </Button>
  );
}

/**
 * TOTP enrolment.
 *
 * The seed and the QR code are generated on the server (the QR is an SVG
 * rendered server-side, so no client-side QR dependency is shipped). Recovery
 * codes are shown exactly once and must be copied by the user.
 */
export function TotpSetup() {
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(confirmTotpAction, {});
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    enrollTotpAction()
      .then((setup) => {
        if (!cancelled) setEnrollment(setup as Enrollment);
      })
      .catch(() => {
        if (!cancelled) setLoadError('تعذّر بدء إعداد المصادقة. أعد تحميل الصفحة.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (loadError) {
    return <Alert tone="danger">{loadError}</Alert>;
  }

  if (state.ok && state.recoveryCodes) {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="تم تفعيل المصادقة الثنائية">
          احفظ رموز الاستعادة في مكان آمن. كل رمز يُستخدم مرة واحدة فقط.
        </Alert>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/50 p-4 font-mono text-sm">
          {state.recoveryCodes.map((code) => (
            <li key={code} className="numeric">
              {code}
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button type="button" onClick={() => router.push('/')}>
            متابعة إلى لوحة التحكم
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pe-5 text-sm text-muted-foreground">
        <li>افتح تطبيق المصادقة (Google Authenticator أو Authy أو 1Password).</li>
        <li>امسح رمز الاستجابة السريعة، أو أدخل المفتاح يدويًا.</li>
        <li>أدخل الرمز المكوّن من 6 أرقام لتأكيد الإعداد.</li>
      </ol>

      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        <div className="rounded-lg border bg-white p-3">
          {enrollment ? (
            <div
              className="size-40 [&_svg]:size-full"
              // Server-rendered SVG from a trusted source (the otpauth URI).
              dangerouslySetInnerHTML={{ __html: enrollment.qr }}
            />
          ) : (
            <div className="size-40 animate-pulse rounded bg-muted" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            المفتاح السري
          </p>
          <Card className="p-3">
            <code className="block break-all font-mono text-xs" dir="ltr">
              {enrollment?.secret ?? '…'}
            </code>
          </Card>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!enrollment}
              onClick={() => enrollment && copy(enrollment.secret)}
            >
              {copied ? 'تم النسخ' : 'نسخ المفتاح'}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <form action={formAction} className="space-y-3">
        {state.error ? <Alert tone="danger">{state.error}</Alert> : null}
        <div className="space-y-2">
          <Label htmlFor="code">رمز التحقق</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            className="text-center text-lg tracking-[0.5em] numeric"
            dir="ltr"
            required
            placeholder="000000"
          />
        </div>
        <div className="flex items-center justify-between">
          <Badge tone="warning">مطلوب لجميع حسابات إدارة المنصة</Badge>
          <ConfirmButton />
        </div>
      </form>
    </div>
  );
}
