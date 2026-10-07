import { describe, expect, it } from 'vitest';
import {
  budgetForExtra,
  extraPaymentForBudget,
  minimumPaymentTotal,
  paginateRows,
  planStartMonth,
  projectionMonthFor,
  upcomingMilestones
} from './plan-workspace';

function month(value: string) {
  return {
    month: value,
    monthNumber: 0,
    targetDebtId: null,
    totalInterestMinor: 0,
    totalPaymentMinor: 0,
    debts: []
  };
}

function milestone(debtId: string, payoffMonth: string) {
  return {
    debtId,
    name: debtId,
    payoffMonth,
    payoffMonthNumber: 0,
    finalPaymentMinor: 0,
    nextTargetDebtId: null,
    nextTargetPaymentMinor: 0
  };
}

describe('plan workspace helpers', () => {
  it('keeps total budget and extra payment synchronized with debt minimums', () => {
    const minimums = minimumPaymentTotal([
      { minimumPaymentMinor: 2_500 },
      { minimumPaymentMinor: 5_000 }
    ]);

    expect(minimums).toBe(7_500);
    expect(extraPaymentForBudget(20_000, minimums)).toBe(12_500);
    expect(extraPaymentForBudget(5_000, minimums)).toBe(0);
    expect(budgetForExtra(minimums, 12_500)).toBe(20_000);
  });

  it('never returns more than 240 amortization rows', () => {
    const rows = Array.from({ length: 525 }, (_, index) => index + 1);

    expect(paginateRows(rows, 0)).toHaveLength(240);
    expect(paginateRows(rows, 1)).toEqual(rows.slice(240, 480));
    expect(paginateRows(rows, 2)).toEqual(rows.slice(480));
    expect(() => paginateRows(rows, 0, 241)).toThrow(/between 1 and 240/);
  });

  it('starts regenerated plans no earlier than the current month', () => {
    expect(planStartMonth('2026-08', '2026-10')).toBe('2026-10');
    expect(planStartMonth('2026-12', '2026-10')).toBe('2026-12');
    expect(planStartMonth('2026-10', '2026-10')).toBe('2026-10');
  });

  it('selects the projection row for the current calendar month', () => {
    const projection = { months: ['2026-08', '2026-09', '2026-10'].map(month) };

    expect(projectionMonthFor(projection, '2026-10')?.month).toBe('2026-10');
    expect(projectionMonthFor(projection, '2026-07')?.month).toBe('2026-08');
    expect(projectionMonthFor(projection, '2027-01')?.month).toBe('2026-10');
    expect(projectionMonthFor({ months: [] }, '2026-10')).toBeNull();
  });

  it('omits milestones that were projected before the current month', () => {
    const projection = {
      milestones: [milestone('a', '2026-09'), milestone('b', '2026-10'), milestone('c', '2027-02')]
    };

    expect(upcomingMilestones(projection, '2026-10').map((item) => item.debtId)).toEqual([
      'b',
      'c'
    ]);
  });
});
