import { expect, test } from '@playwright/test';

test('adds a balance transfer with an exact 0% expiry and surfaces upcoming interest', async ({
  page
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue to debts' }).click();

  await page.getByLabel('Debt type').selectOption('balance-transfer');
  await expect(page.getByRole('switch', { name: /Currently on a 0% promotion/ })).toBeChecked();
  await page.getByLabel('Debt name').fill('Transfer card');
  await page.getByLabel(/Current balance/).fill('1000.00');
  await page.getByLabel('0% ends').fill('2026-08-15');
  await page.getByLabel(/APR after promotion/).fill('24.00');
  await page.getByLabel(/Minimum payment/).fill('50.00');
  await page.getByRole('button', { name: 'Save debt' }).click();

  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('100.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();

  await expect(page.getByText('Check upcoming interest')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Protect your promotional rates' })).toBeVisible();
  const impactSummary = page
    .locator('.promotion-impact-card p')
    .filter({ hasText: 'At your current pace' });
  await expect(impactSummary).toContainText('may still be owed');
  const strategySwitch = page.getByRole('switch', { name: 'Protect 0% offers' });
  await expect(strategySwitch).not.toBeChecked();
  await strategySwitch.click();
  await expect(strategySwitch).toBeChecked();
  await expect(
    page.getByText(/Transfer card is projected to have a balance after its 0% period ends/)
  ).toBeVisible();
  await page.getByRole('button', { name: 'Make this my plan' }).click();

  await page.getByRole('link', { name: 'Debts' }).first().click();
  await expect(page.getByText(/0% through .*2026 · 24\.00% APR after promotion/)).toBeVisible();

  await page.getByRole('link', { name: 'Plan' }).first().click();
  await expect(page.getByRole('heading', { name: 'Check upcoming interest' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Protect 0% offers' })).toBeChecked();
  await expect(
    page.getByText(/Transfer card is projected to have a balance after its 0% period ends/)
  ).toBeVisible();
});
