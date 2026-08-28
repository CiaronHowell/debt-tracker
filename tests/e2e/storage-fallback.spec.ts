import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('keeps a calculator session and export available without IndexedDB', async ({
  page,
  context
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: undefined });
  });

  await page.goto('/settings');
  await expect(page.getByText('Storage is unavailable — session only')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Session only — not saved' })
  ).toBeVisible();
  await expect(page.getByText('Your plan lasts only for this open tab.')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('Storage is unavailable — session only')).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Session only — not saved' })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Session card');
  await page.getByLabel(/Current balance/).fill('240.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('40.00');
  await page.getByRole('button', { name: 'Save debt' }).click();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('80.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();

  await expect(page.getByRole('heading', { name: 'Pay £80.00 to Session card' })).toBeVisible();
  await expect(page.getByText('Changes disappear when this tab closes.')).toBeVisible();
  await page.getByRole('link', { name: 'Export backup' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByText('Changes disappear when this tab closes', { exact: true })
  ).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download plain backup' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.debt-plan\.json$/);
  expect(await download.path()).toBeTruthy();

  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
});
