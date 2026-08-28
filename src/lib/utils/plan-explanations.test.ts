import { describe, expect, it } from 'vitest';
import type { PlanProjectionComparison } from '$lib/application/plan-comparison';
import { explainPlanChanges } from './plan-explanations';

const comparison: PlanProjectionComparison = {
  previousDebtFreeMonth: '2027-08',
  nextDebtFreeMonth: '2027-06',
  debtFreeMonthDelta: -2,
  previousInterestMinor: 2_000,
  nextInterestMinor: 1_500,
  interestDeltaMinor: -500,
  previousPayoffOrder: ['debt-1', 'debt-2'],
  nextPayoffOrder: ['debt-2', 'debt-1'],
  payoffOrderChanged: true,
  previousTarget: { debtId: 'debt-1', name: 'Card' },
  nextTarget: { debtId: 'debt-2', name: 'Loan' },
  targetChanged: true,
  hasIncompleteInterest: false
};

describe('explainPlanChanges', () => {
  it('uses deterministic plain-language templates', () => {
    const messages = explainPlanChanges(comparison, 'GBP').map((item) => item.message);

    expect(messages).toContain('Your debt-free date moved 2 months earlier, to June 2027.');
    expect(messages).toContain(
      'Your payoff order changed because the latest balances changed which debt is smallest.'
    );
    expect(messages).toContain('Your next target changed to Loan.');
    expect(messages).toContain('Estimated interest fell by £5.00.');
  });
});
