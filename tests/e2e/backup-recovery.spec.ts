import { expect, test, type Browser, type Page } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const PASSPHRASE = 'local recovery phrase';

async function createPlan(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/`);
  await page.getByRole('button', { name: 'Continue to debts' }).click();
  await page.getByLabel('Debt name').fill('Recovery card');
  await page.getByLabel(/Current balance/).fill('360.00');
  await page.getByLabel(/APR/).fill('0');
  await page.getByLabel(/Minimum payment/).fill('60.00');
  await page.getByRole('button', { name: 'Save debt' }).click();
  await page.getByRole('button', { name: 'Continue to budget' }).click();
  await page.getByLabel('Plan start month').fill('2026-08');
  await page.getByLabel('Total monthly debt budget').fill('120.00');
  await page.getByRole('button', { name: 'Review my plan' }).click();
  await page.getByRole('button', { name: 'Make this my plan' }).click();
  await page.getByRole('link', { name: 'Settings' }).first().click();
}

async function restoreIntoCleanProfile(
  browser: Browser,
  backupPath: string,
  encrypted: boolean
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/settings`);
  await page.getByLabel('Backup file').setInputFiles(backupPath);
  if (encrypted) await page.getByLabel('Backup passphrase').fill(PASSPHRASE);
  await page.getByRole('button', { name: 'Check backup' }).click();
  await expect(page.getByText('Backup checked')).toBeVisible();
  await expect(page.getByText('1 debts · 1 plans')).toBeVisible();
  await page.getByRole('button', { name: 'Replace data and restore' }).click();

  await expect(page).toHaveURL(`${BASE_URL}/`);
  await expect(page.getByRole('heading', { name: 'Pay £120.00 to Recovery card' })).toBeVisible();
  await page.getByRole('link', { name: 'Plan' }).first().click();
  await expect(page.getByRole('button', { name: /My debt-free plan/ }).first()).toContainText(
    'Active'
  );
  await context.close();
}

test('restores plain and encrypted backups into clean browser profiles', async ({
  page,
  browser
}) => {
  await createPlan(page);

  const plainDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download plain backup' }).click();
  const plainPath = await (await plainDownloadPromise).path();
  expect(plainPath).toBeTruthy();

  await page.getByRole('button', { name: 'Download encrypted backup' }).click();
  await page.getByLabel('Backup passphrase').fill(PASSPHRASE);
  await page.getByLabel('Confirm passphrase').fill(PASSPHRASE);
  const encryptedDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Encrypt and download' }).click();
  const encryptedPath = await (await encryptedDownloadPromise).path();
  expect(encryptedPath).toBeTruthy();

  await restoreIntoCleanProfile(browser, plainPath!, false);
  await restoreIntoCleanProfile(browser, encryptedPath!, true);
});
