import { describe, expect, it } from 'vitest';
import type { PlanProjection } from '$lib/domain';
import { comparePlanProjections } from './plan-comparison';

function projection(overrides: Partial<PlanProjection> = {}): PlanProjection {
  return {
    status: 'success',
    algorithm: 'snowball',
    payoffOrder: ['debt-1', 'debt-2'],
    startMonth: '2026-08',
    debtFreeMonth: '2027-08',
    durationMonths: 13,
    totalStartingBalanceMinor: 20_000,
    totalInterestMinor: 2_000,
    totalPaidMinor: 22_000,
    hasIncompleteInterest: false,
    warnings: [],
    promotionImpacts: [],
    milestones: [],
    months: [
      {
        month: '2026-08',
        monthNumber: 1,
        targetDebtId: 'debt-1',
        totalInterestMinor: 100,
        totalPaymentMinor: 2_000,
        debts: [
          {
            debtId: 'debt-1',
            name: 'Card',
            openingBalanceMinor: 10_000,
            interestMinor: 0,
            requiredPaymentMinor: 1_000,
            paymentMinor: 1_500,
            principalReductionMinor: 1_500,
            closingBalanceMinor: 8_500
          }
        ]
      }
    ],
    minimumOnlyComparison: {
      status: 'available',
      debtFreeMonth: '2028-01',
      durationMonths: 18,
      totalInterestMinor: 3_000,
      monthsSaved: 5,
      interestSavedMinor: 1_000
    },
    ...overrides
  };
}

describe('comparePlanProjections', () => {
  it('reports date, interest, order, and next-target changes', () => {
    const previous = projection();
    const next = projection({
      payoffOrder: ['debt-2', 'debt-1'],
      debtFreeMonth: '2027-06',
      totalInterestMinor: 1_500,
      months: [
        {
          ...previous.months[0]!,
          targetDebtId: 'debt-2',
          debts: [{ ...previous.months[0]!.debts[0]!, debtId: 'debt-2', name: 'Loan' }]
        }
      ]
    });

    expect(comparePlanProjections(previous, next)).toMatchObject({
      debtFreeMonthDelta: -2,
      interestDeltaMinor: -500,
      payoffOrderChanged: true,
      targetChanged: true,
      previousTarget: { debtId: 'debt-1', name: 'Card' },
      nextTarget: { debtId: 'debt-2', name: 'Loan' }
    });
  });

  it('compares a later-starting plan against the remaining months of the previous plan', () => {
    const base = projection();
    const august = base.months[0]!;
    const previous = projection({
      totalInterestMinor: 300,
      months: [
        { ...august, totalInterestMinor: 100 },
        {
          ...august,
          month: '2026-09',
          totalInterestMinor: 100,
          targetDebtId: 'debt-2',
          debts: [{ ...august.debts[0]!, debtId: 'debt-2', name: 'Loan' }]
        },
        { ...august, month: '2026-10', totalInterestMinor: 100 }
      ]
    });
    const next = projection({
      startMonth: '2026-09',
      totalInterestMinor: 150,
      months: [
        {
          ...august,
          month: '2026-09',
          totalInterestMinor: 150,
          targetDebtId: 'debt-2',
          debts: [{ ...august.debts[0]!, debtId: 'debt-2', name: 'Loan' }]
        }
      ]
    });

    expect(comparePlanProjections(previous, next)).toMatchObject({
      previousInterestMinor: 200,
      interestDeltaMinor: -50,
      targetChanged: false,
      previousTarget: { debtId: 'debt-2', name: 'Loan' }
    });
  });
});
