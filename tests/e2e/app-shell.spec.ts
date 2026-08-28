import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('renders the private action-first application shell without third-party requests', async ({
  page
}) => {
  const externalRequests: string[] = [];
  const browserErrors: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Home | Debt Tracker');
  await expect(page.getByRole('heading', { name: 'Know exactly what to pay next.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Build my plan' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main menu' }).first()).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(browserErrors).toEqual([]);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});
