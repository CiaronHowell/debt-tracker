import { monthsBetween, type PlanProjection } from '$lib/domain';

export interface PlanTargetSummary {
  debtId: string;
  name: string;
}

export interface PlanProjectionComparison {
  previousDebtFreeMonth: string;
  nextDebtFreeMonth: string;
  debtFreeMonthDelta: number;
  previousInterestMinor: number;
  nextInterestMinor: number;
  interestDeltaMinor: number;
  previousPayoffOrder: string[];
  nextPayoffOrder: string[];
  payoffOrderChanged: boolean;
  previousTarget: PlanTargetSummary | null;
  nextTarget: PlanTargetSummary | null;
  targetChanged: boolean;
  hasIncompleteInterest: boolean;
}

function firstTarget(projection: PlanProjection): PlanTargetSummary | null {
  const firstMonth = projection.months[0];
  if (!firstMonth?.targetDebtId) return null;
  const target = firstMonth.debts.find((debt) => debt.debtId === firstMonth.targetDebtId);
  return target ? { debtId: target.debtId, name: target.name } : null;
}

export function comparePlanProjections(
  previous: PlanProjection,
  next: PlanProjection
): PlanProjectionComparison {
  const previousTarget = firstTarget(previous);
  const nextTarget = firstTarget(next);
  const payoffOrderChanged =
    previous.payoffOrder.length !== next.payoffOrder.length ||
    previous.payoffOrder.some((debtId, index) => debtId !== next.payoffOrder[index]);

  return {
    previousDebtFreeMonth: previous.debtFreeMonth,
    nextDebtFreeMonth: next.debtFreeMonth,
    debtFreeMonthDelta: monthsBetween(previous.debtFreeMonth, next.debtFreeMonth),
    previousInterestMinor: previous.totalInterestMinor,
    nextInterestMinor: next.totalInterestMinor,
    interestDeltaMinor: next.totalInterestMinor - previous.totalInterestMinor,
    previousPayoffOrder: [...previous.payoffOrder],
    nextPayoffOrder: [...next.payoffOrder],
    payoffOrderChanged,
    previousTarget,
    nextTarget,
    targetChanged: previousTarget?.debtId !== nextTarget?.debtId,
    hasIncompleteInterest: previous.hasIncompleteInterest || next.hasIncompleteInterest
  };
}
