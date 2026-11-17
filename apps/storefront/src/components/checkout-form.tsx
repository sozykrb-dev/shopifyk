'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Alert, Button, FieldHint, Input, Label, Textarea } from '@velnorix/ui';
import { placeOrderAction, type CheckoutState } from '@/app/actions/checkout.js';

function SubmitButton({ total }: { total: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" loading={pending}>
      تأكيد الطلب ({total})
    </Button>
  );
}

/**
 * Checkout form.
 *
 * Collects a name, a phone number and an address -- and nothing about money.
 * Prices are read from the cart inside the action.
 */
export type PaymentMethodOption = {
  provider: string;
  labelAr: string;
  labelEn: string;
};

export function CheckoutForm({
  defaultEmail,
  total,
  methods,
  locale,
}: {
  defaultEmail: string;
  total: string;
  methods: readonly PaymentMethodOption[];
  locale: string;
}) {
  const [state, formAction] = useActionState<CheckoutState, FormData>(placeOrderAction, {});

  return (
    <form action={formAction} className="space-y-4">
      {state.error ? <Alert tone="danger" title={state.error} /> : null}

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={defaultEmail}
          dir="ltr"
          required
        />
        <FieldHint>سنرسل تأكيد الطلب على هذا البريد.</FieldHint>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="shippingName">اسم المستلم</Label>
          <Input
            id="shippingName"
            name="shippingName"
            autoComplete="name"
            defaultValue=""
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">رقم الهاتف</Label>
          <Input
            id="phone"
            name="phone"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            className="numeric"
            placeholder="01012345678"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="addressLine1">العنوان</Label>
        <Input
          id="addressLine1"
          name="addressLine1"
          autoComplete="address-line1"
          placeholder="الشارع، رقم المبنى، الشقة"
          required
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="addressLine2">علامة مميزة (اختياري)</Label>
        <Input
          id="addressLine2"
          name="addressLine2"
          autoComplete="address-line2"
          placeholder="أقرب معلم، الدور، …"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="city">المدينة</Label>
          <Input
            id="city"
            name="city"
            autoComplete="address-level2"
            placeholder="القاهرة"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="region">المحافظة / المنطقة</Label>
          <Input id="region" name="region" autoComplete="address-level1" placeholder="الجيزة" />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">طريقة الدفع</legend>
        <div className="space-y-2">
          {methods.map((method, index) => (
            <label
              key={method.provider}
              className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="paymentMethod"
                value={method.provider}
                defaultChecked={index === 0}
                className="size-4 accent-[hsl(var(--primary))]"
              />
              {locale === 'ar' ? method.labelAr : method.labelEn}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="couponCode">كوبون خصم (اختياري)</Label>
        <Input
          id="couponCode"
          name="couponCode"
          autoComplete="off"
          placeholder="WELCOME10"
          dir="ltr"
          className="numeric"
        />
        <FieldHint>يُتحقَّق من الكوبون عند تأكيد الطلب. إذا لم يكن صالحًا سنخبرك قبل الخصم.</FieldHint>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">ملاحظات على الطلب (اختياري)</Label>
        <Textarea id="notes" name="notes" rows={3} placeholder="موعد التوصيل، تعليمات خاصة…" />
      </div>

      <SubmitButton total={total} />
      <p className="text-xs text-muted-foreground">
        بالضغط على «تأكيد الطلب» يتم احتساب الشحن والضريبة من عنوانك، ثم إنشاء الطلب.
      </p>
    </form>
  );
}
