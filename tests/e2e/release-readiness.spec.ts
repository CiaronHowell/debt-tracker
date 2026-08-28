import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

async function expectNoAccessibilityViolations(page: Page, route: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations, `${route} accessibility violations`).toEqual([]);
}

test('completes the primary flow on mobile and audits every main route', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);
  await expectNoAccessibilityViolations(page, 'Setup');

  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Mobile card');
  await page.getByLabel(/Current balance/).fill('480.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('40.00');
  await page.getByRole('button', { name: 'Save debt' }).click();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('80.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Pay £80.00 to Mobile card' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main menu' }).last()).toBeVisible();

  const routes = [
    { path: '/', name: 'Home' },
    { path: '/debts', name: 'Debts' },
    { path: '/plan', name: 'Plan' },
    { path: '/settings', name: 'Settings' },
    { path: '/privacy', name: 'Privacy' }
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await page.locator('main').waitFor();
    await expectNoAccessibilityViolations(page, route.name);
  }
});
