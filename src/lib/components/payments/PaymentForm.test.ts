import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Debt } from '$lib/persistence';
import PaymentForm from './PaymentForm.svelte';

const debt: Debt = {
  id: 'debt-1',
  name: 'Everyday card',
  type: 'credit-card',
  startingBalanceMinor: 10_000,
  currentBalanceMinor: 10_000,
  balanceAsOf: '2026-08-28',
  balanceSource: 'user',
  aprBasisPoints: 0,
  minimumPaymentMinor: 2_500,
  dueDay: 15,
  notes: '',
  colorKey: null,
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
  archivedAt: null
};

describe('PaymentForm', () => {
  it('prefills the target debt and recommended amount', () => {
    render(PaymentForm, {
      debts: [debt],
      currency: 'GBP',
      defaultDebtId: debt.id,
      defaultAmountMinor: 7_500,
      onsave: vi.fn(),
      oncancel: vi.fn()
    });

    expect((screen.getByLabelText('Debt') as HTMLSelectElement).value).toBe(debt.id);
    expect((screen.getByLabelText(/Payment amount/) as HTMLInputElement).value).toBe('75.00');
    expect((screen.getByLabelText('Paid on') as HTMLInputElement).value).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    );
  });

  it('validates and submits exact minor units', async () => {
    const onsave = vi.fn().mockResolvedValue(undefined);
    render(PaymentForm, {
      debts: [debt],
      currency: 'GBP',
      defaultDebtId: debt.id,
      defaultAmountMinor: 7_500,
      onsave,
      oncancel: vi.fn()
    });

    await fireEvent.input(screen.getByLabelText(/Payment amount/), { target: { value: '12.34' } });
    await fireEvent.input(screen.getByLabelText(/^Note/), { target: { value: 'Monthly payment' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledOnce());
    expect(onsave).toHaveBeenCalledWith(
      expect.objectContaining({ debtId: debt.id, amountMinor: 1_234, note: 'Monthly payment' })
    );
  });
});
