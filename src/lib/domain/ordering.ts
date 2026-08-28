import type { ScenarioDebtInput } from './calculator.types';

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function compareDebtInputs(left: ScenarioDebtInput, right: ScenarioDebtInput): number {
  if (left.balanceMinor !== right.balanceMinor) return left.balanceMinor - right.balanceMinor;

  if (left.aprBasisPoints === null && right.aprBasisPoints !== null) return 1;
  if (left.aprBasisPoints !== null && right.aprBasisPoints === null) return -1;
  if (
    left.aprBasisPoints !== null &&
    right.aprBasisPoints !== null &&
    left.aprBasisPoints !== right.aprBasisPoints
  ) {
    return right.aprBasisPoints - left.aprBasisPoints;
  }

  const createdAtComparison = compareStrings(left.createdAt, right.createdAt);
  if (createdAtComparison !== 0) return createdAtComparison;
  return compareStrings(left.debtId, right.debtId);
}

export function sortDebtInputs(debts: readonly ScenarioDebtInput[]): ScenarioDebtInput[] {
  return [...debts].sort(compareDebtInputs);
}
