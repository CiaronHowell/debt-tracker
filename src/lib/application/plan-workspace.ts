import {
  compareYearMonths,
  type DebtMilestone,
  type MoneyMinor,
  type MonthlyProjection,
  type PlanProjection,
  type ScenarioDebtInput,
  type StartMonthPayment,
  type YearMonth
} from '$lib/domain';
import { checkedAdd, sumMoney } from '$lib/domain/money';

export function minimumPaymentTotal(
  debts: readonly Pick<ScenarioDebtInput, 'minimumPaymentMinor'>[]
): MoneyMinor {
  return sumMoney(debts.map((debt) => debt.minimumPaymentMinor));
}

export function extraPaymentForBudget(
  budgetMinor: MoneyMinor,
  minimumBudgetMinor: MoneyMinor
): MoneyMinor {
  return Math.max(0, budgetMinor - minimumBudgetMinor);
}

export function budgetForExtra(
  minimumBudgetMinor: MoneyMinor,
  extraPaymentMinor: MoneyMinor
): MoneyMinor {
  return checkedAdd(minimumBudgetMinor, extraPaymentMinor);
}

export function paginateRows<T>(rows: readonly T[], page: number, pageSize = 240): T[] {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 240) {
    throw new RangeError('Amortization page size must be between 1 and 240 rows.');
  }
  const normalizedPage = Math.max(0, Math.floor(page));
  const start = normalizedPage * pageSize;
  return rows.slice(start, start + pageSize);
}

/** A plan regenerated from current balances starts no earlier than the current month. */
export function planStartMonth(scenarioStartMonth: YearMonth, currentMonth: YearMonth): YearMonth {
  return compareYearMonths(currentMonth, scenarioStartMonth) > 0
    ? currentMonth
    : scenarioStartMonth;
}

/**
 * The projected row for the given calendar month. Months before the plan starts show the
 * first row; months after the final projected payment show the last row.
 */
export function projectionMonthFor(
  projection: Pick<PlanProjection, 'months'>,
  month: YearMonth
): MonthlyProjection | null {
  const { months } = projection;
  const first = months[0];
  if (!first || compareYearMonths(month, first.month) <= 0) return first ?? null;
  return months.find((row) => row.month === month) ?? months.at(-1) ?? null;
}

export function upcomingMilestones(
  projection: Pick<PlanProjection, 'milestones'>,
  month: YearMonth
): DebtMilestone[] {
  return projection.milestones.filter(
    (milestone) => compareYearMonths(milestone.payoffMonth, month) >= 0
  );
}

/** Totals recorded payments per debt, sorted by debt id so snapshots compare deterministically. */
export function aggregateStartMonthPayments(
  payments: readonly Pick<StartMonthPayment, 'debtId' | 'amountMinor'>[]
): StartMonthPayment[] {
  const totals = new Map<string, MoneyMinor>();
  for (const payment of payments) {
    totals.set(payment.debtId, checkedAdd(totals.get(payment.debtId) ?? 0, payment.amountMinor));
  }
  return [...totals]
    .map(([debtId, amountMinor]) => ({ debtId, amountMinor }))
    .sort((left, right) => left.debtId.localeCompare(right.debtId));
}

export function sameStartMonthPayments(
  left: readonly StartMonthPayment[],
  right: readonly StartMonthPayment[]
): boolean {
  const normalizedLeft = aggregateStartMonthPayments(left);
  const normalizedRight = aggregateStartMonthPayments(right);
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every(
      (payment, index) =>
        payment.debtId === normalizedRight[index].debtId &&
        payment.amountMinor === normalizedRight[index].amountMinor
    )
  );
}
