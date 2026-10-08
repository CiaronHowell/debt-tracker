import { expect, test } from '@playwright/test';

async function completeCoreSetup(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Core card');
  await page.getByLabel(/Current balance/).fill('480.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('40.00');
  await page.getByRole('button', { name: 'Save debt' }).click();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Total monthly debt budget').fill('80.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();
  await expect(page.getByRole('heading', { name: 'Pay £80.00 to Core card' })).toBeVisible();
}

test('tracks a pay-later plan separately from the core debt budget', async ({ page }) => {
  await completeCoreSetup(page);

  await page.getByRole('link', { name: 'Pay later' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pay later' })).toBeVisible();
  await expect(page.getByText('Kept separate from your debt-free plan')).toBeVisible();

  await page.getByRole('button', { name: 'Add pay-later plan' }).first().click();
  await page.getByLabel('Purchase or plan name').fill('Argos furniture');
  await page.getByLabel(/Starting balance/).fill('600.00');
  await page.getByLabel('Purchase or plan start').fill('2026-01-01');
  await page.getByLabel('Pay in full by').fill('2099-12-31');
  await page.getByLabel(/Interest rate if the deadline is missed/).fill('34.90');
  await page.getByRole('button', { name: 'Save pay-later plan' }).click();

  const plan = page.getByRole('article').filter({ hasText: 'Argos furniture' });
  await expect(plan).toContainText('£600.00');
  await expect(plan).toContainText('Set aside each month');
  await expect(
    page.getByLabel('Pay-later totals').getByText('Set aside each month', { exact: true })
  ).toBeVisible();
  await expect(plan).toContainText('Some providers backdate interest to the purchase date');

  await plan.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel(/Amount/).fill('100.00');
  await page
    .getByRole('form', { name: 'Record payment to Argos furniture' })
    .getByRole('button', { name: 'Record payment' })
    .click();
  await expect(plan).toContainText('£500.00');

  await page.getByRole('link', { name: 'Home' }).first().click();
  await expect(page.getByRole('heading', { name: 'Pay £80.00 to Core card' })).toBeVisible();
  const payLaterAction = page.getByRole('region', { name: /Set aside .* this month/ });
  await expect(payLaterAction).toContainText('Pay later — separate from your debt plan');
  await expect(payLaterAction).toContainText('This does not change your core debt budget.');
});
