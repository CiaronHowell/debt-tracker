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

  it('never plans more than the unspent budget plus minimums still due in the first month', () => {
    fc.assert(
      fc.property(
        debtArrayArbitrary,
        fc.array(
          fc.record({ debtIndex: fc.nat(9), amountMinor: fc.integer({ min: 1, max: 20_000 }) }),
          {
            maxLength: 6
          }
        ),
        (debts, payments) => {
          const monthlyBudgetMinor = debts.reduce(
            (total, debt) =>
              total +
              debt.minimumPaymentMinor +
              calculateMonthlyInterest(debt.balanceMinor, debt.aprBasisPoints ?? 0),
            2_000
          );
          // Indexes past the last debt stand for debts already cleared this month.
          const startMonthPayments = payments.map((payment) => ({
            debtId: `debt-${payment.debtIndex}`,
            amountMinor: payment.amountMinor
          }));
          const result = calculatePlan({
            currency: 'GBP',
            startMonth: '2026-01',
            monthlyBudgetMinor,
            debts,
            startMonthPayments
          });

          expect(result.status).toBe('success');
          if (result.status !== 'success') return;

          const paidMinor = startMonthPayments.reduce(
            (total, payment) => total + payment.amountMinor,
            0
          );
          const [firstMonth] = result.months;
          const requiredMinor = firstMonth.debts.reduce(
            (total, row) => total + row.requiredPaymentMinor,
            0
          );
          expect(firstMonth.totalPaymentMinor).toBeLessThanOrEqual(
            Math.max(0, monthlyBudgetMinor - paidMinor - requiredMinor) + requiredMinor
          );
          for (const row of firstMonth.debts) {
            const paidToDebt = startMonthPayments
              .filter((payment) => payment.debtId === row.debtId)
              .reduce((total, payment) => total + payment.amountMinor, 0);
            const debt = debts.find((candidate) => candidate.debtId === row.debtId)!;
            expect(row.requiredPaymentMinor).toBe(
              Math.min(
                Math.max(0, debt.minimumPaymentMinor - paidToDebt),
                row.openingBalanceMinor + row.interestMinor
              )
            );
          }
          for (const month of result.months.slice(1)) {
            expect(month.totalPaymentMinor).toBeLessThanOrEqual(monthlyBudgetMinor);
          }
        }
      ),
      { numRuns: 150 }
    );
  });
});
