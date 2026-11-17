'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, FieldHint, Input, Label } from '@velnorix/ui';
import { verifyMfaAction, type FormState } from '@/app/actions/auth.js';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      تأكيد
    </Button>
  );
}

export function MfaForm() {
  const [state, formAction] = useActionState<FormState, FormData>(verifyMfaAction, {});

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? (
        <Alert tone="danger" title="رمز غير صحيح">
          {state.error}
        </Alert>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="code">رمز التحقق</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={10}
          className="text-center text-lg tracking-[0.5em] numeric"
          dir="ltr"
          required
          autoFocus
          aria-invalid={Boolean(state.error)}
          placeholder="000000"
        />
        <FieldHint>
          أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة، أو أحد رموز الاستعادة.
        </FieldHint>
      </div>

      <SubmitButton />
    </form>
  );
}
