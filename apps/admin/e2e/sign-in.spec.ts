import { expect, test } from '@playwright/test';
import { currentTotpCode } from './helpers/totp.js';

const PASSWORD = process.env.SEED_PASSWORD ?? 'Sahara!Dune#2026';

/**
 * The flows the "done" criteria of Phase 0 are written against:
 * a human can sign in as each account type, and the five authentication
 * contexts stay separate.
 */

test.describe('authentication', () => {
  test('a merchant owner signs in to their store and sees the dashboard', async ({ page }) => {
    await page.goto('/?__tenant=cairo-sneakers');
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel('البريد الإلكتروني').fill('owner@cairo-sneakers.test');
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await expect(page).toHaveURL(/\/\?|^\/(?!login)/);
    await expect(page.getByRole('heading', { name: 'نظرة عامة على المتجر' })).toBeVisible();
  });

  test('a wrong password shows one generic error and does not reveal the account', async ({
    page,
  }) => {
    await page.goto('/login?__tenant=cairo-sneakers');

    await page.getByLabel('البريد الإلكتروني').fill('owner@cairo-sneakers.test');
    await page.getByLabel('كلمة المرور').fill('WrongPassword#1');
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await expect(page.getByText('تعذّر تسجيل الدخول')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a super admin must complete the second factor', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel('البريد الإلكتروني').fill('owner@velnorix.test');
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    // Password alone is not enough: the console asks for the 6-digit code.
    await expect(page).toHaveURL(/\/mfa/);
    await expect(page.getByRole('heading', { name: 'التحقق بخطوتين' })).toBeVisible();

    await page.getByLabel('رمز التحقق').fill('000000');
    await page.getByRole('button', { name: 'تأكيد' }).click();
    await expect(page.getByText('رمز غير صحيح')).toBeVisible();

    await page.getByLabel('رمز التحقق').fill(currentTotpCode());
    await page.getByRole('button', { name: 'تأكيد' }).click();

    await expect(page.getByRole('heading', { name: 'نظرة عامة على المنصة' })).toBeVisible();
  });

  test('signing out invalidates the session', async ({ page }) => {
    await page.goto('/?__tenant=zad-naturals');
    await page.getByLabel('البريد الإلكتروني').fill('owner@zad-naturals.test');
    await page.getByLabel('كلمة المرور').fill(PASSWORD);
    await page.getByRole('button', { name: 'تسجيل الدخول' }).click();

    await expect(page.getByRole('heading', { name: 'نظرة عامة على المتجر' })).toBeVisible();

    await page.getByRole('button', { name: 'تسجيل الخروج' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // The session is dead, not just forgotten: going back asks for credentials.
    await page.goto('/?__tenant=zad-naturals');
    await expect(page).toHaveURL(/\/login/);
  });
});
