import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

function trackApiRequests(page: Page): string[] {
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiRequests.push(`${request.method()} ${url.pathname}`);
  });
  return apiRequests;
}

test('public visitors never contact the sync API', async ({ page }) => {
  const apiRequests = trackApiRequests(page);

  for (const path of ['/', '/debts', '/plan', '/pay-later', '/privacy', '/settings']) {
    await page.goto(path);
    await expect(page.locator('main')).toBeVisible();
  }

  await expect(page.getByRole('link', { name: 'Owner sync' })).toBeVisible();
  await expect(page.getByTestId('app-version')).toHaveText(/^Version \d+\.\d+\.\d+ \(\w+\)$/);
  await expect(page.getByText('Your financial data never leaves this browser.')).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('shows sign-in and rejection states on the account page', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: false, login: null } })
  );

  await page.goto('/account?denied');

  await expect(page.getByRole('heading', { name: 'Cloud sync' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('That GitHub account is not allowed to sync.');
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toHaveAttribute(
    'href',
    '/api/auth/login'
  );

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('the owner can unlock sync and see its status across the app', async ({ page }) => {
  const apiRequests = trackApiRequests(page);
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: true, login: 'owner' } })
  );
  await page.route('**/api/sync**', (route) =>
    route.fulfill({ json: { revision: 0, updatedAt: null, envelope: null } })
  );
  await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { ok: true } }));

  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Signed in as owner' })).toBeVisible();

  await page.getByLabel('Sync passphrase').fill('owner passphrase');
  await page.getByLabel('Confirm passphrase').fill('different');
  await page.getByRole('button', { name: 'Encrypt and upload' }).click();
  await expect(page.getByRole('alert')).toHaveText('The passphrases do not match.');

  await page.getByLabel('Confirm passphrase').fill('owner passphrase');
  await page.getByRole('button', { name: 'Encrypt and upload' }).click();
  await expect(page.getByTestId('sync-status')).toHaveText('Synced');
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();

  // Sync stays enabled for this device and the shell reflects it after navigation.
  await page.getByRole('link', { name: 'Settings' }).first().click();
  await expect(page.getByRole('link', { name: 'Synced' }).first()).toBeVisible();
  await expect(
    page.getByText('Your data is encrypted on this device before it syncs.')
  ).toBeVisible();

  await page.getByRole('link', { name: 'Owner sync' }).click();
  await page.getByRole('button', { name: 'Sign out and stop syncing on this device' }).click();
  await expect(page.getByRole('link', { name: 'Sign in with GitHub' })).toBeVisible();
  expect(apiRequests).toContain('POST /api/auth/logout');

  // A reload after signing out is a public visit again.
  apiRequests.length = 0;
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Owner sync' })).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('a remembered device unlocks itself after a reload until it is locked', async ({ page }) => {
  await page.route('**/api/auth/session', (route) =>
    route.fulfill({ json: { authenticated: true, login: 'owner' } })
  );
  await page.route('**/api/sync**', (route) =>
    route.fulfill({ json: { revision: 0, updatedAt: null, envelope: null } })
  );
  const remembered = page.getByText('This device remembers your passphrase. Lock to forget it.');

  async function unlock(remember: boolean): Promise<void> {
    await page.getByLabel('Sync passphrase').fill('owner passphrase');
    await page.getByLabel('Confirm passphrase').fill('owner passphrase');
    await page.getByLabel('Remember this device').setChecked(remember);
    await page.getByRole('button', { name: 'Encrypt and upload' }).click();
    await expect(page.getByTestId('sync-status')).toHaveText('Synced');
  }

  await page.goto('/account');
  await unlock(false);
  await expect(remembered).toBeHidden();

  // Not remembered: a reload asks for the passphrase again.
  await page.reload();
  await expect(page.getByLabel('Sync passphrase')).toBeVisible();

  await unlock(true);
  await expect(remembered).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('sync-status')).toHaveText('Synced');
  await expect(remembered).toBeVisible();
  await expect(page.getByLabel('Sync passphrase')).toBeHidden();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);

  // Locking forgets the passphrase, so the next reload asks again.
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.getByLabel('Sync passphrase')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('sync-status')).toHaveText('Locked');
  await expect(page.getByLabel('Sync passphrase')).toBeVisible();
});
