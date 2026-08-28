import type { ScenarioDebtInput } from '$lib/domain';

interface CanonicalDebtInput {
  debtId: string;
  name: string;
  balanceMinor: number;
  aprBasisPoints: number | null;
  promotionalAprEndsOn: string | null;
  minimumPaymentMinor: number;
  createdAt: string;
  balanceSource: 'user' | 'estimated';
}

function compareIds(left: CanonicalDebtInput, right: CanonicalDebtInput): number {
  if (left.debtId < right.debtId) return -1;
  if (left.debtId > right.debtId) return 1;
  return 0;
}

export function canonicalizeScenarioDebts(debts: ScenarioDebtInput[]): string {
  const canonical = debts
    .map((debt): CanonicalDebtInput => ({
      debtId: debt.debtId,
      name: debt.name,
      balanceMinor: debt.balanceMinor,
      aprBasisPoints: debt.aprBasisPoints,
      promotionalAprEndsOn: debt.promotionalAprEndsOn ?? null,
      minimumPaymentMinor: debt.minimumPaymentMinor,
      createdAt: debt.createdAt,
      balanceSource: debt.balanceSource ?? 'user'
    }))
    .sort(compareIds);

  return JSON.stringify(canonical);
}

export async function scenarioFingerprint(debts: ScenarioDebtInput[]): Promise<string> {
  const data = new TextEncoder().encode(`debt-snapshot-v1:${canonicalizeScenarioDebts(debts)}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
  return `sha256-v1:${hex}`;
}
