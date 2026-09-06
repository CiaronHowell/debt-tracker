import { describe, expect, it } from 'vitest';
import { calculatePayLaterSchedule } from './pay-later';

describe('calculatePayLaterSchedule', () => {
  it('spreads a balance across the current and deadline months', () => {
    expect(
      calculatePayLaterSchedule({
        startingBalanceMinor: 60_000,
        currentBalanceMinor: 60_000,
        purchaseDate: '2026-09-02',
        deadlineDate: '2027-04-15',
        asOfDate: '2026-09-02'
      })
    ).toEqual({
      status: 'on-track',
      paymentMonthsRemaining: 8,
      totalPaymentMonths: 8,
      baselineMonthlyTargetMinor: 7_500,
      monthlyTargetMinor: 7_500,
      progressPercent: 0
    });
  });

  it('raises the target when the remaining balance is behind the baseline schedule', () => {
    const schedule = calculatePayLaterSchedule({
      startingBalanceMinor: 60_000,
      currentBalanceMinor: 50_000,
      purchaseDate: '2026-09-02',
      deadlineDate: '2027-04-15',
      asOfDate: '2027-01-05'
    });

    expect(schedule).toMatchObject({
      status: 'catch-up',
      paymentMonthsRemaining: 4,
      baselineMonthlyTargetMinor: 7_500,
      monthlyTargetMinor: 12_500,
      progressPercent: 17
    });
  });

  it('marks an unpaid balance overdue after the exact deadline', () => {
    expect(
      calculatePayLaterSchedule({
        startingBalanceMinor: 60_000,
        currentBalanceMinor: 20_000,
        purchaseDate: '2026-09-02',
        deadlineDate: '2027-04-15',
        asOfDate: '2027-04-16'
      })
    ).toMatchObject({ status: 'overdue', paymentMonthsRemaining: 0, monthlyTargetMinor: 20_000 });
  });

  it('keeps the final month available until its exact deadline', () => {
    expect(
      calculatePayLaterSchedule({
        startingBalanceMinor: 10_000,
        currentBalanceMinor: 10_000,
        purchaseDate: '2026-09-01',
        deadlineDate: '2026-09-30',
        asOfDate: '2026-09-30'
      })
    ).toMatchObject({ status: 'on-track', paymentMonthsRemaining: 1, monthlyTargetMinor: 10_000 });
  });

  it('reports completed commitments with no monthly allocation', () => {
    expect(
      calculatePayLaterSchedule({
        startingBalanceMinor: 10_000,
        currentBalanceMinor: 0,
        purchaseDate: '2026-09-01',
        deadlineDate: '2026-12-01',
        asOfDate: '2026-10-01'
      })
    ).toMatchObject({ status: 'paid', monthlyTargetMinor: 0, progressPercent: 100 });
  });
});
