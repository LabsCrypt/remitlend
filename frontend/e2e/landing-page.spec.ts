import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('should load the landing page successfully', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/remitlend|Next/i);

    await expect(page.locator('main')).toBeVisible();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('should display main content elements', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: /templates/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /learning/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /deploy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /documentation/i })).toBeVisible();
  });
});
