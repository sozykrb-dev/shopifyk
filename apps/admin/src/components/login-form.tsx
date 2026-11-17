'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, FieldHint, Input, Label } from '@velnorix/ui';
import { signInAction, type FormState } from '@/app/actions/auth.js';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      {pending ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
    </Button>
  );
}

export function LoginForm({ storeName }: { storeName?: string | null }) {
  const [state, formAction] = useActionState<FormState, FormData>(signInAction, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? (
        <Alert tone="danger" title="تعذّر تسجيل الدخول">
          {state.error}
        </Alert>
      ) : null}

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
          aria-invalid={Boolean(state.error)}
          placeholder={storeName ? `owner@${storeName}` : 'owner@velnorix.com'}
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
          aria-invalid={Boolean(state.error)}
        />
        <FieldHint>كلمة المرور يجب ألا تقل عن 12 حرفًا.</FieldHint>
      </div>

      <SubmitButton />
    </form>
  );
}
