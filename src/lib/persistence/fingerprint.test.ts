import { describe, expect, it } from 'vitest';
import type { ScenarioDebtInput } from '$lib/domain';
import { canonicalizeScenarioDebts, scenarioFingerprint } from './fingerprint';

const first: ScenarioDebtInput = {
  debtId: 'debt-a',
  name: 'Card A',
  balanceMinor: 10_000,
  aprBasisPoints: null,
  minimumPaymentMinor: 1_000,
  createdAt: '2026-08-28T08:00:00.000Z',
  balanceSource: 'user'
};

const second: ScenarioDebtInput = {
  debtId: 'debt-b',
  name: 'Card B',
  balanceMinor: 20_000,
  aprBasisPoints: 1_999,
  minimumPaymentMinor: 2_000,
  createdAt: '2026-08-28T08:01:00.000Z',
  balanceSource: 'estimated'
};

describe('scenario fingerprints', () => {
  it('is deterministic and independent of input ordering', async () => {
    expect(canonicalizeScenarioDebts([first, second])).toBe(
      canonicalizeScenarioDebts([second, first])
    );
    await expect(scenarioFingerprint([first, second])).resolves.toBe(
      await scenarioFingerprint([second, first])
    );
  });

  it('normalizes an omitted balance source to user-entered', async () => {
    const withoutSource = { ...first };
    delete withoutSource.balanceSource;
    await expect(scenarioFingerprint([withoutSource])).resolves.toBe(
      await scenarioFingerprint([first])
    );
  });

  it('distinguishes unknown APR from a known zero-percent APR', async () => {
    await expect(scenarioFingerprint([first])).resolves.not.toBe(
      await scenarioFingerprint([{ ...first, aprBasisPoints: 0 }])
    );
  });
});
