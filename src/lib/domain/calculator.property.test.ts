import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculatePlan } from './calculator';
import type { CalculatePlanInput, ScenarioDebtInput } from './calculator.types';
import { calculateMonthlyInterest } from './money';
import { sortDebtInputs } from './ordering';

const debtArrayArbitrary = fc
  .array(
    fc.record({
      balanceMinor: fc.integer({ min: 500, max: 50_000 }),
      aprBasisPoints: fc.integer({ min: 0, max: 2_400 }),
      minimumPaymentMinor: fc.integer({ min: 50, max: 1_000 }),
      estimated: fc.boolean()
    }),
    { minLength: 1, maxLength: 8 }
  )
  .map((rows): ScenarioDebtInput[] =>
    rows.map((row, index) => ({
      debtId: `debt-${index}`,
      name: `Debt ${index}`,
      balanceMinor: row.balanceMinor,
      aprBasisPoints: row.aprBasisPoints,
      minimumPaymentMinor: row.minimumPaymentMinor,
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
      balanceSource: row.estimated ? 'estimated' : 'user'
    }))
  );

describe('calculatePlan properties', () => {
  it('conserves money and never mutates inputs for converging plans', () => {
    fc.assert(
      fc.property(debtArrayArbitrary, (debts) => {
        const monthlyBudgetMinor = debts.reduce(
          (total, debt) =>
            total +
            debt.minimumPaymentMinor +
            calculateMonthlyInterest(debt.balanceMinor, debt.aprBasisPoints ?? 0),
          2_000
        );
        const calculationInput: CalculatePlanInput = {
          currency: 'GBP',
          startMonth: '2026-01',
          monthlyBudgetMinor,
          debts
        };
        const originalInput = structuredClone(calculationInput);
        const result = calculatePlan(calculationInput);

        expect(result.status).toBe('success');
        if (result.status !== 'success') return;

        expect(result.payoffOrder).toEqual(sortDebtInputs(debts).map((debt) => debt.debtId));
        expect(calculationInput).toEqual(originalInput);

        const finalBalances = new Map<string, number>();
        for (const month of result.months) {
          expect(month.totalPaymentMinor).toBeLessThanOrEqual(monthlyBudgetMinor);
          expect(month.totalPaymentMinor).toBe(
            month.debts.reduce((total, row) => total + row.paymentMinor, 0)
          );
          expect(month.totalInterestMinor).toBe(
            month.debts.reduce((total, row) => total + row.interestMinor, 0)
          );

          for (const row of month.debts) {
            expect(row.openingBalanceMinor + row.interestMinor - row.paymentMinor).toBe(
              row.closingBalanceMinor
            );
            expect(row.paymentMinor).toBeLessThanOrEqual(
              row.openingBalanceMinor + row.interestMinor
            );
            expect(row.closingBalanceMinor).toBeGreaterThanOrEqual(0);
            finalBalances.set(row.debtId, row.closingBalanceMinor);
          }
        }

        expect([...finalBalances.values()]).toHaveLength(debts.length);
        expect([...finalBalances.values()].every((balance) => balance === 0)).toBe(true);
        expect(result.totalPaidMinor).toBe(
          result.totalStartingBalanceMinor + result.totalInterestMinor
        );
      }),
      { numRuns: 150 }
    );
  });
});
