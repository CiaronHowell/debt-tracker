import { expect, test } from '@playwright/test';

test('reloads the saved plan offline through the versioned app shell', async ({
  page,
  context
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Offline card');
  await page.getByLabel(/Current balance/).fill('300.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('50.00');
  await page.getByRole('button', { name: 'Save debt' }).click();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('100.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();
  await page.getByRole('link', { name: 'Plan' }).first().click();
  await expect(page.getByRole('heading', { name: 'Saved plans' })).toBeVisible();

  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.getByRole('heading', { name: 'Saved plans' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByText('You are offline')).toBeVisible();
  await expect(page.getByRole('button', { name: /My debt-free plan/ }).first()).toContainText(
    'Active'
  );
  await context.setOffline(false);
});
