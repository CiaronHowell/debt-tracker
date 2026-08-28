import type { Currency } from '$lib/domain';
import type { PlanProjectionComparison } from '$lib/application/plan-comparison';
import { formatYearMonth } from './dates';
import { formatMoney } from './money';

export interface PlanChangeExplanation {
  key: 'debt-free-date' | 'payoff-order' | 'next-target' | 'interest';
  message: string;
}

function monthCount(value: number): string {
  const count = Math.abs(value);
  return `${count} ${count === 1 ? 'month' : 'months'}`;
}

export function explainPlanChanges(
  comparison: PlanProjectionComparison,
  currency: Currency
): PlanChangeExplanation[] {
  const explanations: PlanChangeExplanation[] = [];

  if (comparison.debtFreeMonthDelta < 0) {
    explanations.push({
      key: 'debt-free-date',
      message: `Your debt-free date moved ${monthCount(comparison.debtFreeMonthDelta)} earlier, to ${formatYearMonth(comparison.nextDebtFreeMonth)}.`
    });
  } else if (comparison.debtFreeMonthDelta > 0) {
    explanations.push({
      key: 'debt-free-date',
      message: `Your debt-free date moved ${monthCount(comparison.debtFreeMonthDelta)} later, to ${formatYearMonth(comparison.nextDebtFreeMonth)}.`
    });
  } else {
    explanations.push({
      key: 'debt-free-date',
      message: `Your debt-free estimate stays at ${formatYearMonth(comparison.nextDebtFreeMonth)}.`
    });
  }

  if (comparison.payoffOrderChanged) {
    explanations.push({
      key: 'payoff-order',
      message:
        'Your payoff order changed because the latest balances changed which debt is smallest.'
    });
  } else {
    explanations.push({
      key: 'payoff-order',
      message: 'Your payoff order stays the same.'
    });
  }

  if (comparison.targetChanged && comparison.nextTarget) {
    explanations.push({
      key: 'next-target',
      message: `Your next target changed to ${comparison.nextTarget.name}.`
    });
  } else if (comparison.nextTarget) {
    explanations.push({
      key: 'next-target',
      message: `Your next target remains ${comparison.nextTarget.name}.`
    });
  }

  if (comparison.hasIncompleteInterest) {
    explanations.push({
      key: 'interest',
      message: 'Interest totals are incomplete because one or more debts have no APR.'
    });
  } else if (comparison.interestDeltaMinor < 0) {
    explanations.push({
      key: 'interest',
      message: `Estimated interest fell by ${formatMoney(Math.abs(comparison.interestDeltaMinor), currency)}.`
    });
  } else if (comparison.interestDeltaMinor > 0) {
    explanations.push({
      key: 'interest',
      message: `Estimated interest increased by ${formatMoney(comparison.interestDeltaMinor, currency)}.`
    });
  } else {
    explanations.push({ key: 'interest', message: 'Estimated interest is unchanged.' });
  }

  return explanations;
}
