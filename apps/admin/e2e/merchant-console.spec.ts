import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Sahara!Dune#2026';

/**
 * The merchant's own console.
 *
 * These three pages were added after the Phase 0 suite was written, and each
 * one makes a promise that a unit test cannot keep:
 *
 *   - `/billing` promises a merchant sees *their* subscription and not the
 *     platform's revenue. Same route, two audiences — get the dispatch wrong
 *     and it is a data leak that looks like a nav item.
 *   - `/staff` promises nobody edits their own access. The action refuses it;
 *     the page also disables the control so the refusal is not a surprise.
 *   - `/customers` promises guests are counted. A list built from accounts
 *     instead of orders renders fine and is simply wrong.
 *
 * They are read-only on purpose. A suite that changes roles or invoice
 * statuses on a seeded database makes every other test order-dependent.
 */

test.describe('the merchant console', () => {
  async function signInAsCairoOwner(page: Page) {
    await page.goto('/?__tenant=cairo-sneakers');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('البريد الإلكتروني').fill('owner@cairo-sneakers.test');
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();
    await expect(page.getByRole('heading', { name: 'نظرة عامة على المتجر' })).toBeVisible();
  }

  test('a merchant sees their own subscription, not the platform revenue', async ({ page }) => {
    await signInAsCairoOwner(page);
    await page.goto('/billing');

    await expect(page.getByRole('heading', { name: 'الاشتراك والفواتير' })).toBeVisible();
    await expect(page.getByText('تفاصيل الاشتراك')).toBeVisible();

    /*
     * The assertion that matters. The platform console's headline is "الإيراد
     * الشهري المتكرر"; if it appears here, the route is serving the wrong
     * audience and every merchant can read everyone's revenue.
     */
    await expect(page.getByText('الإيراد الشهري المتكرر')).toHaveCount(0);
    await expect(page.getByText('اشتراكات المتاجر')).toHaveCount(0);
  });

  test('a merchant sees their customers, including the ones who never registered', async ({
    page,
  }) => {
    await signInAsCairoOwner(page);
    await page.goto('/customers');

    await expect(page.getByRole('heading', { name: 'العملاء' })).toBeVisible();
    await expect(page.getByText('قائمة العملاء')).toBeVisible();

    /*
     * Guest buyers are the reason this page is built from orders rather than
     * accounts. On the seeded store most customers are guests, so if this
     * badge is missing the page has quietly reverted to listing accounts.
     */
    await expect(page.getByText('ضيف').first()).toBeVisible();
    await expect(page.getByText('طلبوا كضيوف')).toBeVisible();
  });

  test('a merchant cannot change their own access', async ({ page }) => {
    await signInAsCairoOwner(page);
    await page.goto('/staff');

    await expect(page.getByRole('heading', { name: 'فريق العمل' })).toBeVisible();

    // Their own row is marked, so the restriction is visible rather than a
    // surprise rejection after the fact.
    await expect(page.getByText('(أنت)')).toBeVisible();

    /*
     * The card for the signed-in owner is the one holding the "(أنت)" marker.
     * Both controls on it — the role select and the disable button — must be
     * disabled. The action refuses either way; this is about not offering.
     */
    const ownRow = page.locator('[data-testid="staff-row"][data-self="true"]');
    await expect(ownRow).toHaveCount(1);
    await expect(ownRow.getByRole('combobox')).toBeDisabled();
    await expect(ownRow.getByRole('button', { name: 'تعطيل' })).toBeDisabled();

    // Another member's row stays editable, or the page has disabled everyone
    // and the rule has been applied to the wrong rows.
    const otherRow = page
      .locator('[data-testid="staff-row"][data-self="false"]')
      .filter({ hasText: 'manager@cairo' });
    await expect(otherRow.getByRole('combobox')).toBeEnabled();
  });
});
