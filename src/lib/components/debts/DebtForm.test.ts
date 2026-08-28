import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DebtForm from './DebtForm.svelte';

describe('DebtForm', () => {
  it('shows field-level errors and does not submit invalid values', async () => {
    const onsave = vi.fn();
    render(DebtForm, { currency: 'GBP', onsave });

    await fireEvent.click(screen.getByRole('button', { name: 'Save debt' }));

    expect(screen.getByText('Enter a name between 1 and 80 characters.')).toBeTruthy();
    expect(screen.getByText(/Enter a balance greater than 0/)).toBeTruthy();
    expect(screen.getByText(/Enter a minimum payment greater than 0/)).toBeTruthy();
    expect(onsave).not.toHaveBeenCalled();
  });

  it('submits normalized integer money and APR values', async () => {
    const onsave = vi.fn().mockResolvedValue(undefined);
    render(DebtForm, { currency: 'GBP', onsave });

    await fireEvent.input(screen.getByLabelText('Debt name'), {
      target: { value: '  Test card  ' }
    });
    await fireEvent.input(screen.getByLabelText(/Current balance/), {
      target: { value: '123.45' }
    });
    await fireEvent.input(screen.getByLabelText(/APR/), { target: { value: '19.99' } });
    await fireEvent.input(screen.getByLabelText(/Minimum payment/), {
      target: { value: '25.00' }
    });
    await fireEvent.input(screen.getByLabelText(/Due day/), { target: { value: '15' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save debt' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledOnce());
    expect(onsave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test card',
        balanceMinor: 12_345,
        aprBasisPoints: 1_999,
        minimumPaymentMinor: 2_500,
        dueDay: 15
      })
    );
  });

  it('defaults balance transfers to a 0% promotion and submits exact expiry terms', async () => {
    const onsave = vi.fn().mockResolvedValue(undefined);
    render(DebtForm, { currency: 'GBP', onsave });

    await fireEvent.change(screen.getByLabelText('Debt type'), {
      target: { value: 'balance-transfer' }
    });
    expect(
      (
        screen.getByRole('switch', {
          name: /Currently on a 0% promotion/
        }) as HTMLInputElement
      ).checked
    ).toBe(true);

    await fireEvent.input(screen.getByLabelText('Debt name'), {
      target: { value: 'Transfer card' }
    });
    await fireEvent.input(screen.getByLabelText(/Current balance/), {
      target: { value: '2500.00' }
    });
    await fireEvent.input(screen.getByLabelText('0% ends'), {
      target: { value: '2027-10-15' }
    });
    await fireEvent.input(screen.getByLabelText(/APR after promotion/), {
      target: { value: '24.90' }
    });
    await fireEvent.input(screen.getByLabelText(/Minimum payment/), {
      target: { value: '75.00' }
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save debt' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledOnce());
    expect(onsave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'balance-transfer',
        promotionalAprEndsOn: '2027-10-15',
        aprBasisPoints: 2_490
      })
    );
  });
});
