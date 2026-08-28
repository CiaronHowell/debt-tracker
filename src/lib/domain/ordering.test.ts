import { describe, expect, it } from 'vitest';
import type { ScenarioDebtInput } from './calculator.types';
import { sortDebtInputs } from './ordering';

function debt(
  debtId: string,
  balanceMinor: number,
  aprBasisPoints: number | null,
  createdAt = '2026-01-01T00:00:00.000Z'
): ScenarioDebtInput {
  return {
    debtId,
    name: debtId,
    balanceMinor,
    aprBasisPoints,
    minimumPaymentMinor: 10,
    createdAt
  };
}

describe('snowball ordering', () => {
  it('orders by balance, then known highest APR, date, and identifier', () => {
    const inputs = [
      debt('unknown', 100, null),
      debt('later', 100, 2_000, '2026-01-02T00:00:00.000Z'),
      debt('b', 100, 2_000),
      debt('a', 100, 2_000),
      debt('lower-apr', 100, 1_000),
      debt('smallest', 50, 0)
    ];
    const original = structuredClone(inputs);

    expect(sortDebtInputs(inputs).map((item) => item.debtId)).toEqual([
      'smallest',
      'a',
      'b',
      'later',
      'lower-apr',
      'unknown'
    ]);
    expect(inputs).toEqual(original);
  });
});
