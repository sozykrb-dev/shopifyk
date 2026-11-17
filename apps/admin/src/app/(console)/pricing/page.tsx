import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@velnorix/ui';
import { formatMoney } from '@velnorix/core';
import {
  couponUsage,
  listCoupons,
  listShippingRates,
  listTaxRules,
  withTenant,
} from '@velnorix/db';
import {
  deactivateCouponAction,
  deactivateShippingRateAction,
  deactivateTaxRuleAction,
} from '@/app/actions/pricing.js';
import { CouponForm, ShippingRateForm, TaxRuleForm } from '@/components/pricing-forms.js';
import { requirePrincipal } from '@/lib/session.js';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'التسعير' };

/**
 * Pricing rules.
 *
 * This page is the answer to ADR 0007's "tax handling: a decision, not a
 * guess". The rules that decide what a customer pays live here as rows a human
 * reviews, and the engine that applies them is a pure function in
 * `packages/pricing`.
 *
 * A store that has configured nothing charges no tax and no shipping -- the
 * default is a zero rate, never an invented one.
 */
export default async function PricingPage() {
  const { principal, storeId } = await requirePrincipal(['merchant_owner', 'merchant_staff']);
  if (!storeId) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold tracking-tight">التسعير</h1>
        <p className="text-sm text-muted-foreground">هذا النطاق غير مرتبط بأي متجر.</p>
      </div>
    );
  }

  const canWrite = principal.permissions.has('store:settings.write');

  const [taxRules, shippingRates, coupons] = await withTenant(storeId, async (db) => [
    await listTaxRules(db),
    await listShippingRates(db),
    await listCoupons(db),
  ]);

  const usage = await withTenant(storeId, async (db) =>
    Promise.all(coupons.map((coupon) => couponUsage(db, coupon.id))),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">التسعير</h1>
        <p className="text-sm text-muted-foreground">
          الضرائب والشحن والكوبونات: قواعد يقررها المتجر، ويطبّقها محرك تسعير واحد لا يتغير بتغير
          الصفحة.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>قواعد الضريبة</CardTitle>
          <CardDescription>
            {taxRules.length === 0
              ? 'لا توجد قواعد: المتجر لا يحتسب ضريبة حتى تضيف قاعدة.'
              : `${taxRules.length} قاعدة — تُطابَق على عنوان العميل.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {taxRules.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-start font-medium">الاسم</th>
                    <th className="px-2 py-2 text-start font-medium">النسبة</th>
                    <th className="px-2 py-2 text-start font-medium">النطاق</th>
                    <th className="px-2 py-2 text-start font-medium">شاملة</th>
                    <th className="px-2 py-2 text-start font-medium">على الشحن</th>
                    <th className="px-2 py-2 text-start font-medium">الحالة</th>
                    {canWrite ? <th className="px-2 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {taxRules.map((rule) => (
                    <tr key={rule.id} className="border-b last:border-0">
                      <td className="px-2 py-2 font-medium">{rule.nameAr}</td>
                      <td className="numeric px-2 py-2">{(rule.rateBps / 100).toFixed(2)}%</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {rule.countryCode === '*' ? 'كل الدول' : rule.countryCode}
                        {rule.region ? ` / ${rule.region}` : ''}
                      </td>
                      <td className="px-2 py-2">{rule.priceInclusive ? 'نعم' : 'لا'}</td>
                      <td className="px-2 py-2">{rule.taxesShipping ? 'نعم' : 'لا'}</td>
                      <td className="px-2 py-2">
                        <Badge tone={rule.active ? 'success' : 'neutral'}>
                          {rule.active ? 'مفعّلة' : 'موقوفة'}
                        </Badge>
                      </td>
                      {canWrite ? (
                        <td className="px-2 py-2 text-end">
                          {rule.active ? (
                            <form action={deactivateTaxRuleAction}>
                              <input type="hidden" name="id" value={rule.id} />
                              <Button type="submit" variant="ghost" size="sm">
                                إيقاف
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Separator />
          <TaxRuleForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>طرق الشحن</CardTitle>
          <CardDescription>
            {shippingRates.length === 0
              ? 'لا توجد طرق شحن: الطلبات تُحتسب بدون تكلفة توصيل.'
              : 'يُختار أفضل سعر يغطي عنوان العميل.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {shippingRates.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-start font-medium">الاسم</th>
                    <th className="px-2 py-2 text-start font-medium">التكلفة</th>
                    <th className="px-2 py-2 text-start font-medium">مجاني فوق</th>
                    <th className="px-2 py-2 text-start font-medium">النطاق</th>
                    <th className="px-2 py-2 text-start font-medium">المدة</th>
                    {canWrite ? <th className="px-2 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {shippingRates.map((rate) => (
                    <tr key={rate.id} className="border-b last:border-0">
                      <td className="px-2 py-2 font-medium">{rate.nameAr}</td>
                      <td className="numeric px-2 py-2">
                        {formatMoney({ amount: rate.amountMinor, currency: rate.currency }, 'ar')}
                      </td>
                      <td className="numeric px-2 py-2">
                        {rate.freeAboveMinor === null
                          ? '—'
                          : formatMoney(
                              { amount: rate.freeAboveMinor, currency: rate.currency },
                              'ar',
                            )}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {rate.countryCode === '*' ? 'كل الدول' : rate.countryCode}
                        {rate.region ? ` / ${rate.region}` : ''}
                        {rate.city ? ` / ${rate.city}` : ''}
                      </td>
                      <td className="numeric px-2 py-2 text-muted-foreground">
                        {rate.minDays ?? '?'}–{rate.maxDays ?? '؟'} يوم
                      </td>
                      {canWrite ? (
                        <td className="px-2 py-2 text-end">
                          {rate.active ? (
                            <form action={deactivateShippingRateAction}>
                              <input type="hidden" name="id" value={rate.id} />
                              <Button type="submit" variant="ghost" size="sm">
                                إيقاف
                              </Button>
                            </form>
                          ) : (
                            <Badge tone="neutral">موقوفة</Badge>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <Separator />
          <ShippingRateForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>الكوبونات</CardTitle>
          <CardDescription>
            عدد مرات الاستخدام محسوب من سجلات الاستخدام الفعلية، لا من عدّاد قد ينحرف عنها.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {coupons.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-2 py-2 text-start font-medium">الرمز</th>
                    <th className="px-2 py-2 text-start font-medium">الخصم</th>
                    <th className="px-2 py-2 text-start font-medium">الحد الأدنى</th>
                    <th className="numeric px-2 py-2 text-start font-medium">الاستخدام</th>
                    <th className="px-2 py-2 text-start font-medium">الصلاحية</th>
                    <th className="px-2 py-2 text-start font-medium">الحالة</th>
                    {canWrite ? <th className="px-2 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {coupons.map((coupon, index) => {
                    const counts = usage[index];
                    return (
                      <tr key={coupon.id} className="border-b last:border-0">
                        <td className="numeric px-2 py-2 font-medium">{coupon.code}</td>
                        <td className="numeric px-2 py-2">
                          {coupon.type === 'percent'
                            ? `${(coupon.value / 100).toFixed(2)}%`
                            : formatMoney(
                                { amount: coupon.value, currency: coupon.currency },
                                'ar',
                              )}
                        </td>
                        <td className="numeric px-2 py-2">
                          {formatMoney(
                            { amount: coupon.minSubtotalMinor, currency: coupon.currency },
                            'ar',
                          )}
                        </td>
                        <td className="numeric px-2 py-2">
                          {counts?.total ?? 0}
                          {coupon.usageLimit !== null ? ` / ${coupon.usageLimit}` : ''}
                        </td>
                        <td className="numeric px-2 py-2 text-muted-foreground">
                          {coupon.startsAt ? coupon.startsAt.toISOString().slice(0, 10) : 'الآن'}
                          {' → '}
                          {coupon.endsAt ? coupon.endsAt.toISOString().slice(0, 10) : 'مفتوح'}
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={coupon.active ? 'success' : 'neutral'}>
                            {coupon.active ? 'مفعّل' : 'موقوف'}
                          </Badge>
                        </td>
                        {canWrite ? (
                          <td className="px-2 py-2 text-end">
                            {coupon.active ? (
                              <form action={deactivateCouponAction}>
                                <input type="hidden" name="id" value={coupon.id} />
                                <Button type="submit" variant="ghost" size="sm">
                                  إيقاف
                                </Button>
                              </form>
                            ) : null}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <Separator />
          <CouponForm />
        </CardContent>
      </Card>
    </div>
  );
}
