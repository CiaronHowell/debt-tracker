import type { MoneyMinor, ScenarioDebtInput } from '$lib/domain';
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
