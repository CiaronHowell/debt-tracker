import { describe, expect, it } from 'vitest';
import goldenFixture from '../../../tests/fixtures/golden-zero-interest.json';
import { calculatePlan } from './calculator';
import type { CalculatePlanInput, PlanProjection, ScenarioDebtInput } from './calculator.types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function debt(
  debtId: string,
  balanceMinor: number,
  minimumPaymentMinor: number,
  aprBasisPoints: number | null = 0,
  overrides: Partial<ScenarioDebtInput> = {}
): ScenarioDebtInput {
  return {
    debtId,
    name: `Debt ${debtId}`,
    balanceMinor,
    aprBasisPoints,
    minimumPaymentMinor,
    createdAt: CREATED_AT,
    ...overrides
  };
}

function input(
  debts: ScenarioDebtInput[],
  monthlyBudgetMinor: number,
  overrides: Partial<CalculatePlanInput> = {}
): CalculatePlanInput {
  return {
    currency: 'GBP',
    startMonth: '2026-01',
    monthlyBudgetMinor,
    debts,
    ...overrides
  };
}

function expectSuccess(result: ReturnType<typeof calculatePlan>): PlanProjection {
  expect(result.status).toBe('success');
  if (result.status !== 'success') throw new Error(`Expected success, received ${result.code}`);
  return result;
}

describe('calculatePlan', () => {
  it('matches the complete zero-interest golden schedule', () => {
    const fixture = goldenFixture as unknown as {
      input: CalculatePlanInput;
      expected: Pick<
        PlanProjection,
        | 'payoffOrder'
        | 'debtFreeMonth'
        | 'durationMonths'
        | 'totalStartingBalanceMinor'
        | 'totalInterestMinor'
        | 'totalPaidMinor'
        | 'months'
      >;
    };

    const projection = expectSuccess(calculatePlan(fixture.input));

    expect({
      payoffOrder: projection.payoffOrder,
      debtFreeMonth: projection.debtFreeMonth,
      durationMonths: projection.durationMonths,
      totalStartingBalanceMinor: projection.totalStartingBalanceMinor,
      totalInterestMinor: projection.totalInterestMinor,
      totalPaidMinor: projection.totalPaidMinor,
      months: projection.months
    }).toEqual(fixture.expected);
  });

  it('applies interest before payment with exact minor-unit rounding', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 10_000, 1_000, 1_200)], 1_000))
    );

    expect(projection.months[0].debts[0]).toMatchObject({
      openingBalanceMinor: 10_000,
      interestMinor: 100,
      paymentMinor: 1_000,
      principalReductionMinor: 900,
      closingBalanceMinor: 9_100
    });
  });

  it('orders several debts by balance and keeps that order frozen', () => {
    const projection = expectSuccess(
      calculatePlan(
        input([debt('large', 2_000, 100), debt('small', 500, 100), debt('medium', 1_000, 100)], 600)
      )
    );

    expect(projection.payoffOrder).toEqual(['small', 'medium', 'large']);
    const targetSequence = projection.months.map((month) => month.targetDebtId);
    expect(targetSequence.indexOf('medium')).toBeGreaterThan(targetSequence.lastIndexOf('small'));
    expect(targetSequence.indexOf('large')).toBeGreaterThan(targetSequence.lastIndexOf('medium'));
  });

  it('uses highest APR, known APR, creation time, and ID as deterministic ties', () => {
    const projection = expectSuccess(
      calculatePlan(
        input(
          [
            debt('unknown', 1_000, 100, null),
            debt('low', 1_000, 100, 100),
            debt('later', 1_000, 100, 200, { createdAt: '2026-01-02T00:00:00.000Z' }),
            debt('b', 1_000, 100, 200),
            debt('a', 1_000, 100, 200)
          ],
          1_000
        )
      )
    );

    expect(projection.payoffOrder).toEqual(['a', 'b', 'later', 'low', 'unknown']);
  });

  it('applies minimums to non-target debts and cascades surplus in the payoff month', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 100, 20), debt('b', 200, 20)], 100))
    );

    expect(projection.months[0].debts.find((row) => row.debtId === 'b')?.paymentMinor).toBe(20);
    expect(projection.months[1].debts).toEqual([
      expect.objectContaining({ debtId: 'a', paymentMinor: 20, closingBalanceMinor: 0 }),
      expect.objectContaining({ debtId: 'b', paymentMinor: 80, closingBalanceMinor: 100 })
    ]);
  });

  it('caps a required and final payment at the remaining balance', () => {
    const projection = expectSuccess(calculatePlan(input([debt('a', 50, 100)], 1_000)));

    expect(projection.months[0]).toMatchObject({ totalPaymentMinor: 50 });
    expect(projection.months[0].debts[0]).toMatchObject({
      requiredPaymentMinor: 50,
      paymentMinor: 50,
      closingBalanceMinor: 0
    });
  });

  it('accepts a budget exactly equal to required minimums', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 300, 100), debt('b', 300, 100)], 200))
    );

    expect(projection.months[0].totalPaymentMinor).toBe(200);
    expect(projection.months[0].debts.map((row) => row.paymentMinor)).toEqual([100, 100]);
  });

  it('returns the exact shortfall when the budget cannot cover minimums', () => {
    const result = calculatePlan(input([debt('a', 1_000, 200), debt('b', 1_000, 300)], 400));

    expect(result).toEqual({
      status: 'failure',
      code: 'INSUFFICIENT_BUDGET',
      message: 'The monthly budget does not cover this month’s required minimum payments.',
      details: {
        month: '2026-01',
        monthlyBudgetMinor: 400,
        requiredPaymentsMinor: 500,
        shortfallMinor: 100
      }
    });
  });

  it('uses zero for an unknown APR and marks interest as incomplete', () => {
    const projection = expectSuccess(calculatePlan(input([debt('a', 100, 20, null)], 100)));

    expect(projection.hasIncompleteInterest).toBe(true);
    expect(projection.totalInterestMinor).toBe(0);
    expect(projection.warnings).toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_APR', debtId: 'a' })
    );
  });

  it('warns about estimated balances and negative amortization while allowing convergence', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 10_000, 500, 12_000, { balanceSource: 'estimated' })], 2_000))
    );

    expect(projection.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ESTIMATED_BALANCE', debtId: 'a' }),
        expect.objectContaining({ code: 'NEGATIVE_AMORTIZATION_AT_MINIMUM', debtId: 'a' })
      ])
    );
    expect(projection.debtFreeMonth).toBeDefined();
  });

  it('returns NON_CONVERGING after the configured simulation limit', () => {
    const result = calculatePlan(input([debt('a', 1_000_000, 8, 1)], 8, { maximumMonths: 1_200 }));

    expect(result).toMatchObject({
      status: 'failure',
      code: 'NON_CONVERGING',
      details: { maximumMonths: 1_200 }
    });
  });

  it('warns when reconciled balances change the previous payoff order', () => {
    const projection = expectSuccess(
      calculatePlan(
        input([debt('a', 2_000, 100), debt('b', 1_000, 100)], 500, {
          previousPayoffOrder: ['a', 'b']
        })
      )
    );

    expect(projection.payoffOrder).toEqual(['b', 'a']);
    expect(projection.warnings).toContainEqual(
      expect.objectContaining({ code: 'PAYOFF_ORDER_CHANGED' })
    );
  });

  it('reports a minimum-only comparison with duration and interest savings', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 100, 20), debt('b', 200, 20)], 100))
    );

    expect(projection.minimumOnlyComparison).toEqual({
      status: 'available',
      debtFreeMonth: '2026-10',
      durationMonths: 10,
      totalInterestMinor: 0,
      monthsSaved: 7,
      interestSavedMinor: 0
    });
  });

  it('marks the minimum-only comparison unavailable when a debt never decreases', () => {
    const projection = expectSuccess(calculatePlan(input([debt('a', 10_000, 500, 12_000)], 2_000)));

    expect(projection.minimumOnlyComparison).toEqual({
      status: 'unavailable',
      reason: 'NON_CONVERGING_DEBT',
      debtIds: ['a']
    });
  });

  it('returns typed failures for missing and invalid input', () => {
    expect(calculatePlan(input([], 100))).toMatchObject({ status: 'failure', code: 'NO_DEBTS' });
    expect(calculatePlan(input([debt('a', 100, 10)], -1))).toMatchObject({
      status: 'failure',
      code: 'INVALID_INPUT',
      details: { domainCode: 'INVALID_MONEY' }
    });
    expect(
      calculatePlan(input([debt('a', 100, 10)], 100, { startMonth: '2026-13' }))
    ).toMatchObject({
      status: 'failure',
      code: 'INVALID_INPUT',
      details: { domainCode: 'INVALID_DATE' }
    });
  });

  it('does not mutate caller-owned input', () => {
    const calculationInput = input([debt('b', 200, 20), debt('a', 100, 20)], 100);
    const original = structuredClone(calculationInput);

    calculatePlan(calculationInput);

    expect(calculationInput).toEqual(original);
  });

  it('uses 0% through the expiry date and prorates the remaining expiry-month days', () => {
    const projection = expectSuccess(
      calculatePlan(
        input(
          [
            debt('promo', 10_000, 1_000, 1_200, {
              promotionalAprEndsOn: '2026-01-15'
            })
          ],
          1_000
        )
      )
    );

    expect(projection.months[0].debts[0]).toMatchObject({
      openingBalanceMinor: 10_000,
      interestMinor: 52,
      closingBalanceMinor: 9_052
    });
    expect(projection.months[1].debts[0].interestMinor).toBe(91);
    expect(projection.warnings).toContainEqual(
      expect.objectContaining({ code: 'PROMOTION_EXPIRES_BEFORE_PAYOFF', debtId: 'promo' })
    );
  });

  it('reports actionable 0% deadline impact figures for the current plan', () => {
    const projection = expectSuccess(
      calculatePlan(
        input(
          [
            debt('promo', 2_500, 100, 3_600, {
              name: 'Transfer card',
              promotionalAprEndsOn: '2026-03-31'
            }),
            debt('small', 1_000, 100)
          ],
          1_000
        )
      )
    );

    expect(projection.promotionImpacts).toEqual([
      {
        debtId: 'promo',
        name: 'Transfer card',
        promotionalAprEndsOn: '2026-03-31',
        postPromotionAprBasisPoints: 3_600,
        atRisk: true,
        balanceAtExpiryMinor: 500,
        firstFullMonthInterestMinor: 15,
        paymentMonthsRemaining: 3,
        requiredMonthlyPaymentMinor: 834,
        plannedMonthlyPaymentMinor: 666,
        monthlyPaymentShortfallMinor: 168
      }
    ]);
  });

  it('opts into deadline-aware extra payments without changing minimum payments', () => {
    const debts = [
      debt('promo', 2_500, 100, 3_600, { promotionalAprEndsOn: '2026-03-31' }),
      debt('small', 1_000, 100)
    ];
    const snowball = expectSuccess(calculatePlan(input(debts, 1_000)));
    const protectedPlan = expectSuccess(
      calculatePlan(input(debts, 1_000, { algorithm: 'deadline-aware' }))
    );

    expect(snowball.months[0].targetDebtId).toBe('small');
    expect(protectedPlan).toMatchObject({
      algorithm: 'deadline-aware',
      payoffOrder: ['promo', 'small']
    });
    expect(protectedPlan.months[0].targetDebtId).toBe('promo');
    expect(protectedPlan.months[0].debts.find((row) => row.debtId === 'small')).toMatchObject({
      requiredPaymentMinor: 100,
      paymentMinor: 100
    });
    expect(protectedPlan.promotionImpacts[0]).toMatchObject({
      atRisk: false,
      balanceAtExpiryMinor: 0,
      firstFullMonthInterestMinor: 0
    });
    expect(protectedPlan.totalInterestMinor).toBeLessThan(snowball.totalInterestMinor);
  });

  it('warns about an unknown post-promotion APR only when the plan crosses expiry', () => {
    const paidDuringPromotion = expectSuccess(
      calculatePlan(
        input([debt('paid-early', 100, 100, null, { promotionalAprEndsOn: '2026-12-31' })], 100)
      )
    );
    expect(paidDuringPromotion.hasIncompleteInterest).toBe(false);
    expect(paidDuringPromotion.warnings).not.toContainEqual(
      expect.objectContaining({ code: 'UNKNOWN_APR' })
    );

    const crossesExpiry = expectSuccess(
      calculatePlan(
        input(
          [debt('unknown-after', 1_000, 100, null, { promotionalAprEndsOn: '2026-01-15' })],
          100
        )
      )
    );
    expect(crossesExpiry.hasIncompleteInterest).toBe(true);
    expect(crossesExpiry.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PROMOTION_EXPIRES_BEFORE_PAYOFF',
          debtId: 'unknown-after'
        }),
        expect.objectContaining({ code: 'UNKNOWN_APR', debtId: 'unknown-after' })
      ])
    );
  });
});

describe('projection metadata', () => {
  it('records payoff milestones and the next target payment', () => {
    const projection = expectSuccess(
      calculatePlan(input([debt('a', 100, 20), debt('b', 200, 20)], 100))
    );

    expect(projection.milestones).toEqual([
      {
        debtId: 'a',
        name: 'Debt a',
        payoffMonth: '2026-02',
        payoffMonthNumber: 2,
        finalPaymentMinor: 20,
        nextTargetDebtId: 'b',
        nextTargetPaymentMinor: 100
      },
      {
        debtId: 'b',
        name: 'Debt b',
        payoffMonth: '2026-03',
        payoffMonthNumber: 3,
        finalPaymentMinor: 100,
        nextTargetDebtId: null,
        nextTargetPaymentMinor: 0
      }
    ]);
  });

  it('warns when repayment takes longer than 30 years', () => {
    const projection = expectSuccess(calculatePlan(input([debt('a', 400, 1)], 1)));

    expect(projection.durationMonths).toBe(400);
    expect(projection.warnings).toContainEqual(
      expect.objectContaining({ code: 'LONG_REPAYMENT_PERIOD' })
    );
  });
});
