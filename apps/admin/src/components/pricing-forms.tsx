'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FieldHint,
  Input,
  Label,
} from '@velnorix/ui';
import {
  createCouponAction,
  createShippingRateAction,
  createTaxRuleAction,
  type PricingFormState,
} from '@/app/actions/pricing.js';

/**
 * The forms that change what a store charges.
 *
 * Each form posts to its own Server Action, which re-checks the permission and
 * re-resolves the store server-side. Nothing here is trusted: a disabled button
 * is a courtesy, not a control.
 */

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

function Feedback({ state }: { state: PricingFormState }) {
  if (state.error) return <Alert tone="danger" title={state.error} />;
  if (state.ok) return <Alert tone="success" title={state.ok} />;
  return null;
}

function Field({
  label,
  name,
  hint,
  ...props
}: { label: string; name: string; hint?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} {...props} />
      {hint ? <FieldHint>{hint}</FieldHint> : null}
    </div>
  );
}

function Checkbox({
  label,
  name,
  hint,
  defaultChecked,
}: {
  label: string;
  name: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
      />
      <span className="space-y-0.5">
        <span className="block font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function TaxRuleForm() {
  const [state, action] = useActionState<PricingFormState, FormData>(createTaxRuleAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>إضافة قاعدة ضريبة</CardTitle>
        <CardDescription>
          تُطابَق القاعدة على دولة الطلب ومحافظته، والقاعدة الأكثر تحديدًا تفوز.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <Feedback state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="الاسم بالعربية"
              name="nameAr"
              placeholder="ضريبة القيمة المضافة"
              required
            />
            <Field label="الاسم بالإنجليزية" name="nameEn" placeholder="VAT" dir="ltr" />
            <Field
              label="النسبة %"
              name="rate"
              inputMode="decimal"
              placeholder="14"
              className="numeric"
              dir="ltr"
              required
            />
            <Field
              label="كود الدولة"
              name="countryCode"
              defaultValue="EG"
              className="numeric"
              dir="ltr"
            />
            <Field label="المحافظة (اختياري)" name="region" placeholder="القاهرة" />
            <Field
              label="الأولوية"
              name="priority"
              inputMode="numeric"
              defaultValue="0"
              className="numeric"
              dir="ltr"
              hint="الأعلى أولوية يفوز عند تساوي التحديد."
            />
          </div>
          <Checkbox
            label="السعر شامل الضريبة"
            name="priceInclusive"
            defaultChecked
            hint="الضريبة مُضمَّنة في سعر الرف وتُستخرج منه ولا تُضاف إليه."
          />
          <Checkbox label="احتساب الضريبة على الشحن" name="taxesShipping" />
          <Submit label="إضافة القاعدة" />
        </form>
      </CardContent>
    </Card>
  );
}

export function ShippingRateForm() {
  const [state, action] = useActionState<PricingFormState, FormData>(createShippingRateAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>إضافة طريقة شحن</CardTitle>
        <CardDescription>
          يُختار أفضل سعر يغطي عنوان العميل. يمكن ترك المحافظة والمدينة فارغين لتغطية كل الدولة.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <Feedback state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم بالعربية" name="nameAr" placeholder="شحن عادي" required />
            <Field label="الاسم بالإنجليزية" name="nameEn" placeholder="Standard" dir="ltr" />
            <Field
              label="التكلفة (ج.م)"
              name="amount"
              inputMode="decimal"
              placeholder="30"
              className="numeric"
              dir="ltr"
              required
            />
            <Field
              label="شحن مجاني فوق (ج.م)"
              name="freeAbove"
              inputMode="decimal"
              placeholder="500"
              className="numeric"
              dir="ltr"
              hint="اتركه فارغًا لتعطيل الشحن المجاني."
            />
            <Field
              label="كود الدولة"
              name="countryCode"
              defaultValue="EG"
              className="numeric"
              dir="ltr"
            />
            <Field label="المحافظة (اختياري)" name="region" placeholder="الجيزة" />
            <Field label="المدينة (اختياري)" name="city" placeholder="مدينة نصر" />
            <Field
              label="العملة"
              name="currency"
              defaultValue="EGP"
              className="numeric"
              dir="ltr"
            />
            <Field
              label="أقل مدة (أيام)"
              name="minDays"
              inputMode="numeric"
              defaultValue="2"
              className="numeric"
              dir="ltr"
            />
            <Field
              label="أقصى مدة (أيام)"
              name="maxDays"
              inputMode="numeric"
              defaultValue="5"
              className="numeric"
              dir="ltr"
            />
            <Field
              label="الأولوية"
              name="priority"
              inputMode="numeric"
              defaultValue="0"
              className="numeric"
              dir="ltr"
            />
          </div>
          <Submit label="إضافة طريقة الشحن" />
        </form>
      </CardContent>
    </Card>
  );
}

export function CouponForm() {
  const [state, action] = useActionState<PricingFormState, FormData>(createCouponAction, {});
  return (
    <Card>
      <CardHeader>
        <CardTitle>إنشاء كوبون</CardTitle>
        <CardDescription>
          يُتحقَّق من الكوبون عند كل طلب: الصلاحية والحد الأدنى وعدد مرات الاستخدام تُفحص لحظة الدفع، لا
          عند إنشاء الكوبون.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4">
          <Feedback state={state} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="الرمز"
              name="code"
              placeholder="WELCOME10"
              className="numeric"
              dir="ltr"
              required
              hint="يُحفظ بأحرف كبيرة، والمقارنة لا تميّز بينها."
            />
            <div className="space-y-2">
              <Label htmlFor="type">النوع</Label>
              <select
                id="type"
                name="type"
                defaultValue="percent"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="percent">نسبة مئوية</option>
                <option value="fixed">مبلغ ثابت</option>
              </select>
              <FieldHint>النسبة تُكتب هكذا 10، والمبلغ الثابت بالجنيه هكذا 50.</FieldHint>
            </div>
            <Field
              label="القيمة"
              name="value"
              inputMode="decimal"
              placeholder="10"
              className="numeric"
              dir="ltr"
              required
            />
            <Field
              label="الحد الأدنى للطلب (ج.م)"
              name="minSubtotal"
              inputMode="decimal"
              defaultValue="0"
              className="numeric"
              dir="ltr"
            />
            <Field
              label="حد الاستخدام الكلي"
              name="usageLimit"
              inputMode="numeric"
              className="numeric"
              dir="ltr"
              hint="اتركه فارغًا لغير محدود."
            />
            <Field
              label="حد الاستخدام لكل عميل"
              name="perCustomerLimit"
              inputMode="numeric"
              className="numeric"
              dir="ltr"
              hint="اتركه فارغًا لغير محدود."
            />
            <Field label="يبدأ في" name="startsAt" type="date" className="numeric" dir="ltr" />
            <Field label="ينتهي في" name="endsAt" type="date" className="numeric" dir="ltr" />
            <Field
              label="العملة"
              name="currency"
              defaultValue="EGP"
              className="numeric"
              dir="ltr"
            />
          </div>
          <Checkbox label="يطبَّق الخصم على الشحن أيضًا" name="appliesToShipping" />
          <Submit label="إنشاء الكوبون" />
        </form>
      </CardContent>
    </Card>
  );
}
