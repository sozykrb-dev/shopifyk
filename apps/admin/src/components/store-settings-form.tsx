'use client';

import { useActionState, useState } from 'react';
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
  Separator,
} from '@velnorix/ui';
import { updateStoreSettingsAction, type SettingsFormState } from '@/app/actions/store-settings.js';

/**
 * Store settings form.
 *
 * The colour picker has a live preview, because "primary colour" is an
 * abstract idea until you see it on a button. The value is still validated on
 * the server — the preview is a convenience, not the control.
 *
 * The currency list arrives as a prop rather than being imported from
 * `@velnorix/core`: that package pulls `node:crypto` in with it, and a `node:`
 * import inside a client component is a build failure, not a warning.
 */

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      حفظ الإعدادات
    </Button>
  );
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

export type SettingsValues = {
  name: string;
  currency: string;
  locale: string;
  timezone: string;
  themeKey: string;
  primaryColor: string;
  logoUrl: string;
};

export function StoreSettingsForm({
  initial,
  currencies,
}: {
  initial: SettingsValues;
  currencies: readonly string[];
}) {
  const [state, action] = useActionState<SettingsFormState, FormData>(
    updateStoreSettingsAction,
    {},
  );
  const [colour, setColour] = useState(initial.primaryColor);

  const validColour = /^#[0-9a-fA-F]{6}$/.test(colour);

  return (
    <form action={action} className="space-y-6">
      {state.error ? <Alert tone="danger" title={state.error} /> : null}
      {state.ok ? <Alert tone="success" title={state.ok} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>بيانات المتجر</CardTitle>
          <CardDescription>الاسم والعملة واللغة الافتراضية.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="اسم المتجر"
            name="name"
            defaultValue={initial.name}
            required
            maxLength={120}
          />
          <div className="space-y-2">
            <Label htmlFor="currency">العملة</Label>
            <select
              id="currency"
              name="currency"
              defaultValue={initial.currency}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <FieldHint>تُستخدم في كل الأسعار والفواتير.</FieldHint>
          </div>
          <div className="space-y-2">
            <Label htmlFor="locale">اللغة الافتراضية</Label>
            <select
              id="locale"
              name="locale"
              defaultValue={initial.locale}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <Field
            label="المنطقة الزمنية"
            name="timezone"
            defaultValue={initial.timezone}
            className="numeric"
            dir="ltr"
            hint="مثال: Africa/Cairo"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>المظهر</CardTitle>
          <CardDescription>
            اللون الأساسي يظهر في الأزرار والروابط في كل صفحات المتجر.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="themeKey">القالب</Label>
              <select
                id="themeKey"
                name="themeKey"
                defaultValue={initial.themeKey}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="dawn">فجر</option>
                <option value="dusk">غسق</option>
                <option value="sand">رمال</option>
                <option value="ink">حبر</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="primaryColor">اللون الأساسي</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="اختر اللون"
                  value={validColour ? colour : '#0f766e'}
                  onChange={(event) => setColour(event.target.value)}
                  className="size-9 shrink-0 cursor-pointer rounded-md border bg-background p-1"
                />
                <Input
                  id="primaryColor"
                  name="primaryColor"
                  value={colour}
                  onChange={(event) => setColour(event.target.value)}
                  className="numeric"
                  dir="ltr"
                />
              </div>
              {validColour ? null : (
                <FieldHint>اللون يجب أن يكون ستة أرقام ستة عشرية، مثال: #0f766e.</FieldHint>
              )}
            </div>
          </div>

          <Field
            label="رابط الشعار"
            name="logoUrl"
            defaultValue={initial.logoUrl}
            className="numeric"
            dir="ltr"
            placeholder="https://…"
            hint="اتركه فارغًا لعرض اسم المتجر. يجب أن يبدأ بـ https://"
          />

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium">معاينة</p>
            <div
              className="rounded-md border p-4"
              style={{ ['--primary' as string]: validColour ? hexToHslTriplet(colour) : undefined }}
            >
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{initial.name}</span>
                <span
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
                  style={{ background: validColour ? colour : '#0f766e' }}
                >
                  أضف إلى السلة
                </span>
              </div>
            </div>
            <FieldHint>المعاينة تقريبية: المتجر يطبق اللون على كل العناصر.</FieldHint>
          </div>
        </CardContent>
      </Card>

      <Submit />
    </form>
  );
}

/**
 * `#0f766e` -> `174 72% 26%`, the triplet the design tokens expect.
 *
 * Duplicated from the storefront's own converter on purpose: the preview must
 * not import server code into a client component just to format a colour.
 */
function hexToHslTriplet(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) return `0 0% ${Math.round(lightness * 100)}%`;

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  return `${hue} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}
