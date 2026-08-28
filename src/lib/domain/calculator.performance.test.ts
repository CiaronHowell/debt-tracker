import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { calculatePlan } from './calculator';
import type { CalculatePlanInput } from './calculator.types';

function performanceInput(): CalculatePlanInput {
  return {
    currency: 'GBP',
    startMonth: '2026-01',
    monthlyBudgetMinor: 100,
    maximumMonths: 1_200,
    debts: Array.from({ length: 100 }, (_, index) => ({
      debtId: `debt-${String(index).padStart(3, '0')}`,
      name: `Debt ${index}`,
      balanceMinor: 1_200,
      aprBasisPoints: 0,
      minimumPaymentMinor: 1,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
  };
}

describe('calculator performance budget', () => {
  it('projects 100 debts across 1,200 months in under 100 ms', () => {
    const input = performanceInput();
    calculatePlan(input);
    const timings: number[] = [];

    for (let iteration = 0; iteration < 5; iteration += 1) {
      const startedAt = performance.now();
      const result = calculatePlan(input);
      timings.push(performance.now() - startedAt);
      expect(result).toMatchObject({ status: 'success', durationMonths: 1_200 });
    }

    timings.sort((left, right) => left - right);
    const medianMs = timings[2];
    expect(medianMs).toBeLessThan(100);
  });
});
