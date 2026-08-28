import { describe, expect, it } from 'vitest';
import {
  budgetForExtra,
  extraPaymentForBudget,
  minimumPaymentTotal,
  paginateRows
} from './plan-workspace';

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
});
