import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('creates, compares, renames, refreshes, and activates saved plans', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url());
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Continue to debts' }).click();

  await page.getByLabel('Debt name').fill('Small card');
  await page.getByLabel(/Current balance/).fill('100.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('25.00');
  await page.getByRole('button', { name: 'Save debt' }).click();

  await page.getByRole('button', { name: 'Add another debt' }).click();
  await page.getByLabel('Debt name').fill('Large loan');
  await page.getByLabel(/Current balance/).fill('500.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('50.00');
  await page.getByRole('button', { name: 'Save debt' }).click();

  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('150.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();

  await page.getByRole('link', { name: 'Plan' }).first().click();
  await expect(page.getByRole('heading', { name: 'Saved plans' })).toBeVisible();
  await expect(page.getByText('1 saved plan')).toBeVisible();
  const savedPlans = page.getByRole('complementary', { name: 'Saved plans' });
  const initialPlan = savedPlans.getByRole('button', { name: /My debt-free plan/ });
  await expect(initialPlan).toContainText('Active');
  await expect(page.getByRole('heading', { name: 'Timeline and monthly schedule' })).toBeVisible();

  await page.getByRole('button', { name: /Small card.*Projected paid off/ }).click();
  const schedule = page.getByRole('table', { name: 'Small card monthly amortization' });
  await expect(schedule).toBeVisible();
  expect(await schedule.locator('tbody tr').count()).toBeLessThanOrEqual(24);

  const comparison = page.getByRole('region', { name: 'Live comparison' });
  await expect(comparison.getByText('No change').first()).toBeVisible();
  await page.getByLabel('Total monthly budget').fill('50.00');
  await expect(page.getByRole('alert')).toContainText('minimum payments');
  await expect(comparison.getByText('No change').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as scenario' })).toBeDisabled();

  await page.getByLabel('Extra payment above minimums').fill('125.00');
  await expect(page.getByLabel('Total monthly budget')).toHaveValue('200.00');
  await expect(page.getByRole('alert')).toBeHidden();
  await page.getByLabel('Saved plan name').fill('Fast track');
  await page.getByRole('button', { name: 'Save as scenario' }).click();

  await expect(page.getByText('2 saved plans')).toBeVisible();
  await expect(page.getByText('Fast track was saved on this device.')).toBeVisible();
  await page.getByRole('button', { name: 'Rename Fast track' }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Weekend sprint');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByText('Plan renamed to Weekend sprint.')).toBeVisible();

  await page.getByRole('button', { name: 'Make active plan' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Make this your active plan?' });
  await expect(dialog.getByText('Your other saved plans will remain available.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Make active plan' }).click();
  await expect(page.getByText('Weekend sprint is now your active plan.')).toBeVisible();
  await expect(savedPlans.getByRole('button', { name: /Weekend sprint/ })).toContainText('Active');
  await expect(savedPlans.getByRole('button', { name: /My debt-free plan/ })).toBeVisible();

  await page.getByRole('link', { name: 'Debts' }).first().click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByLabel(/Current balance/).fill('90.00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('link', { name: 'Plan' }).first().click();

  await expect(page.getByRole('heading', { name: 'This plan uses older balances' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Make active plan' }).first()).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh current balances' }).click();
  await expect(page.getByText('Weekend sprint now uses your current balances.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This plan uses older balances' })).toBeHidden();

  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
  expect(externalRequests).toEqual([]);
});
