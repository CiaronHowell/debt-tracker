import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('records a payment, reconciles the balance, and confirms the updated active plan', async ({
  page
}) => {
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') externalRequests.push(request.url());
  });
  await page.clock.setFixedTime(new Date('2026-08-28T09:00:00'));

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

  await expect(page.getByRole('heading', { name: 'Pay £100.00 to Small card' })).toBeVisible();
  await expect(page.getByText('Large loan').first()).toBeVisible();
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Record a payment' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Record payment' })).toBeFocused();
  await page.getByRole('button', { name: 'Record payment' }).click();

  const paymentDialog = page.getByRole('dialog', { name: 'Record a payment' });
  await expect(paymentDialog.getByLabel('Debt').locator('option:checked')).toHaveText('Small card');
  await expect(paymentDialog.getByLabel(/Payment amount/)).toHaveValue('100.00');
  await paymentDialog.getByLabel(/^Note/).fill('August payment');
  await paymentDialog.getByRole('button', { name: 'Record payment' }).click();

  const review = page.getByRole('region', { name: 'Review your updated plan' });
  await expect(review).toBeVisible();
  await expect(review.getByText('Estimated balance after payment')).toBeVisible();
  await expect(review.getByText('£0.00')).toBeVisible();
  await expect(review.getByText('Your next target changed to Large loan.')).toBeVisible();

  await review.getByRole('button', { name: 'Enter statement balance' }).click();
  await review.getByLabel(/Statement balance/).fill('5.00');
  await review.getByRole('button', { name: 'Use statement balance' }).click();
  await expect(review.getByText('Your next target remains Small card.')).toBeVisible();
  await review.getByRole('button', { name: 'Use updated plan' }).click();

  await expect(
    page.getByText('Your updated plan is now active and saved on this device.')
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pay £5.00 to Small card' })).toBeVisible();
  await expect(page.getByText('£505.00')).toBeVisible();
  await expect(page.getByText('£100.00').last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent payments' })).toBeVisible();

  expect(await new AxeBuilder({ page }).analyze()).toMatchObject({ violations: [] });
  expect(externalRequests).toEqual([]);
});

test('shows the current month of an active plan that started in an earlier month', async ({
  page
}) => {
  await page.clock.setFixedTime(new Date('2026-10-07T09:00:00'));
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

  // August pays off Small card; by October the whole budget goes to Large loan.
  await expect(page.getByRole('heading', { name: 'Pay £150.00 to Large loan' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Other minimum payments' }).getByText('October 2026')
  ).toBeVisible();
});
