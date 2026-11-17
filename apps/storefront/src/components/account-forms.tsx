'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, FieldHint, Input, Label } from '@velnorix/ui';
import {
  loginAction,
  registerAction,
  verifyEmailAction,
  type FormState,
} from '@/app/actions/account.js';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {label}
    </Button>
  );
}

function ErrorLine({ state }: { state: FormState }) {
  if (!state.error) return null;
  return <Alert tone="danger" title={state.error} />;
}

/** Customer sign-in. The form never says whether the address exists. */
export function LoginForm({ verified }: { verified?: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="space-y-4">
      {verified ? (
        <Alert tone="success" title="تم تأكيد بريدك الإلكتروني. سجّل الدخول الآن." />
      ) : null}
      <ErrorLine state={state} />

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          dir="ltr"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
        />
      </div>

      <SubmitButton label="تسجيل الدخول" />
    </form>
  );
}

/** Customer registration. Ends on "check your inbox" either way. */
export function RegisterForm() {
  const [state, formAction] = useActionState<FormState, FormData>(registerAction, {});

  if (state.ok) {
    return (
      <div className="space-y-3">
        <Alert tone="success" title="تم إنشاء الحساب. أكّد بريدك الإلكتروني لتتمكن من الدخول." />
        {state.devToken ? (
          <VerifyForm initialToken={state.devToken} />
        ) : (
          <p className="text-sm text-muted-foreground">
            أرسلنا رابط التأكيد إلى بريدك. اتبع الرابط لتفعيل الحساب.
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <ErrorLine state={state} />

      <div className="space-y-2">
        <Label htmlFor="fullName">الاسم بالكامل</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          dir="ltr"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          required
        />
        <FieldHint>١٢ حرفًا على الأقل، وتحتوي على حرف كبير وصغير ورقم ورمز.</FieldHint>
      </div>

      <SubmitButton label="إنشاء حساب" />
    </form>
  );
}

/** Pastes or follows the single-use verification token. */
export function VerifyForm({ initialToken }: { initialToken?: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(verifyEmailAction, {});

  return (
    <form action={formAction} className="space-y-3">
      <ErrorLine state={state} />
      <div className="space-y-2">
        <Label htmlFor="token">رمز التأكيد</Label>
        <Input id="token" name="token" defaultValue={initialToken ?? ''} dir="ltr" required />
        {initialToken ? (
          <FieldHint>
            في بيئة التطوير يظهر الرمز هنا بدل إرساله بالبريد. في الإنتاج يُرسل بالبريد فقط.
          </FieldHint>
        ) : null}
      </div>
      <SubmitButton label="تأكيد البريد" />
    </form>
  );
}
