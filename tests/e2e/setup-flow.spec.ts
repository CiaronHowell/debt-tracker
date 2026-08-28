import { expect, test } from '@playwright/test';

test('completes setup, activates a valid plan, and edits the persisted debt', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Test card');
  await page.getByLabel(/Current balance/).fill('100.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('25.00');
  await page.getByLabel(/Due day/).fill('15');
  await page.getByRole('button', { name: 'Save debt' }).click();

  await expect(page.getByText('£100.00 balance · £25.00 minimum')).toBeVisible();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('100.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your debt repayment plan is ready.' })
  ).toBeVisible();
  await expect(page.getByText('August 2026').first()).toBeVisible();
  await page.getByRole('button', { name: 'Make this my plan' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Pay £100.00 to Test card' })).toBeVisible();

  await page.getByRole('link', { name: 'Debts' }).first().click();
  await expect(page.getByText('£100.00').first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel(/Current balance/).fill('80.00');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByText('£80.00').first()).toBeVisible();
});
