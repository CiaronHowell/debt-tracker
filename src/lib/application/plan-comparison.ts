import { compareYearMonths, monthsBetween, type PlanProjection } from '$lib/domain';
import { projectionMonthFor } from './plan-workspace';

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

function targetFor(projection: PlanProjection, month: string): PlanTargetSummary | null {
  const row = projectionMonthFor(projection, month);
  if (!row?.targetDebtId) return null;
  const target = row.debts.find((debt) => debt.debtId === row.targetDebtId);
  return target ? { debtId: target.debtId, name: target.name } : null;
}

function interestFrom(projection: PlanProjection, month: string): number {
  if (compareYearMonths(month, projection.startMonth) <= 0) return projection.totalInterestMinor;
  return projection.months
    .filter((row) => compareYearMonths(row.month, month) >= 0)
    .reduce((total, row) => total + row.totalInterestMinor, 0);
}

export function comparePlanProjections(
  previous: PlanProjection,
  next: PlanProjection
): PlanProjectionComparison {
  // The next plan may start later than the previous one (regenerated in a later month), so
  // compare targets and remaining interest from the next plan's start month.
  const previousTarget = targetFor(previous, next.startMonth);
  const nextTarget = targetFor(next, next.startMonth);
  const previousInterestMinor = interestFrom(previous, next.startMonth);
  const payoffOrderChanged =
    previous.payoffOrder.length !== next.payoffOrder.length ||
    previous.payoffOrder.some((debtId, index) => debtId !== next.payoffOrder[index]);

  return {
    previousDebtFreeMonth: previous.debtFreeMonth,
    nextDebtFreeMonth: next.debtFreeMonth,
    debtFreeMonthDelta: monthsBetween(previous.debtFreeMonth, next.debtFreeMonth),
    previousInterestMinor,
    nextInterestMinor: next.totalInterestMinor,
    interestDeltaMinor: next.totalInterestMinor - previousInterestMinor,
    previousPayoffOrder: [...previous.payoffOrder],
    nextPayoffOrder: [...next.payoffOrder],
    payoffOrderChanged,
    previousTarget,
    nextTarget,
    targetChanged: previousTarget?.debtId !== nextTarget?.debtId,
    hasIncompleteInterest: previous.hasIncompleteInterest || next.hasIncompleteInterest
  };
}
