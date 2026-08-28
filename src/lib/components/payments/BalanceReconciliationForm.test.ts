import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import type { Debt } from '$lib/persistence';
import BalanceReconciliationForm from './BalanceReconciliationForm.svelte';

const debt: Debt = {
  id: 'debt-1',
  name: 'Everyday card',
  type: 'credit-card',
  startingBalanceMinor: 10_000,
  currentBalanceMinor: 2_000,
  balanceAsOf: '2026-08-28',
  balanceSource: 'estimated',
  aprBasisPoints: 0,
  minimumPaymentMinor: 2_500,
  dueDay: 15,
  notes: '',
  colorKey: null,
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T08:00:00.000Z',
  archivedAt: null
};

describe('BalanceReconciliationForm', () => {
  it('submits a zero statement balance as an exact reconciliation', async () => {
    const onsave = vi.fn().mockResolvedValue(undefined);
    render(BalanceReconciliationForm, {
      debts: [debt],
      currency: 'GBP',
      defaultDebtId: debt.id,
      onsave,
      oncancel: vi.fn()
    });

    await fireEvent.input(screen.getByLabelText(/Statement balance/), {
      target: { value: '0.00' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Use statement balance' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledOnce());
    expect(onsave).toHaveBeenCalledWith(
      expect.objectContaining({ debtId: debt.id, balanceMinor: 0 })
    );
  });
});
