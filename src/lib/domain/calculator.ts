import type {
  CalculatePlanInput,
  CalculatePlanResult,
  CalculationFailure,
  DebtMilestone,
  MinimumOnlyComparison,
  MonthlyDebtProjection,
  MonthlyProjection,
  PlanProjection,
  ProjectionWarning,
  ScenarioDebtInput
} from './calculator.types';
import { addMonths, parseYearMonth } from './dates';
import { DomainError } from './errors';
import {
  assertAprBasisPoints,
  assertMoneyMinor,
  calculateMonthlyInterest,
  capPayment,
  checkedAdd,
  checkedSubtract,
  sumMoney
} from './money';
import { sortDebtInputs } from './ordering';

const DEFAULT_MAXIMUM_MONTHS = 1_200;
const SUPPORTED_CURRENCIES = new Set(['GBP', 'EUR', 'USD']);

interface DebtState {
  debt: ScenarioDebtInput;
  balanceMinor: number;
}

interface PendingMilestone {
  debtId: string;
  name: string;
  payoffMonth: string;
  payoffMonthNumber: number;
  finalPaymentMinor: number;
}

function failure(
  code: CalculationFailure['code'],
  message: string,
  details: Record<string, unknown> = {}
): CalculationFailure {
  return { status: 'failure', code, message, details };
}

function validateInput(input: CalculatePlanInput): number {
  if (!SUPPORTED_CURRENCIES.has(input.currency)) {
    throw new DomainError('INVALID_MONEY', 'Currency must be GBP, EUR, or USD.', {
      currency: input.currency
    });
  }

  parseYearMonth(input.startMonth, 'startMonth');
  assertMoneyMinor(input.monthlyBudgetMinor, 'monthlyBudgetMinor');

  const maximumMonths = input.maximumMonths ?? DEFAULT_MAXIMUM_MONTHS;
  if (!Number.isSafeInteger(maximumMonths) || maximumMonths < 1 || maximumMonths > 1_200) {
    throw new DomainError('INVALID_DATE', 'maximumMonths must be an integer between 1 and 1200.', {
      maximumMonths
    });
  }

  const debtIds = new Set<string>();
  for (const debt of input.debts) {
    if (typeof debt.debtId !== 'string' || debt.debtId.trim().length === 0) {
      throw new DomainError('INVALID_MONEY', 'Every debt requires a non-empty debtId.');
    }
    if (debtIds.has(debt.debtId)) {
      throw new DomainError('INVALID_MONEY', 'Debt identifiers must be unique.', {
        debtId: debt.debtId
      });
    }
    debtIds.add(debt.debtId);

    if (typeof debt.name !== 'string' || debt.name.trim().length === 0) {
      throw new DomainError('INVALID_MONEY', 'Every debt requires a non-empty name.', {
        debtId: debt.debtId
      });
    }

    assertMoneyMinor(debt.balanceMinor, `${debt.debtId}.balanceMinor`);
    if (debt.balanceMinor === 0) {
      throw new DomainError('INVALID_MONEY', 'Active debt balances must be greater than zero.', {
        debtId: debt.debtId
      });
    }

    assertMoneyMinor(debt.minimumPaymentMinor, `${debt.debtId}.minimumPaymentMinor`);
    if (debt.minimumPaymentMinor === 0) {
      throw new DomainError('INVALID_MONEY', 'Minimum payments must be greater than zero.', {
        debtId: debt.debtId
      });
    }

    if (debt.aprBasisPoints !== null) {
      assertAprBasisPoints(debt.aprBasisPoints, `${debt.debtId}.aprBasisPoints`);
    }

    if (typeof debt.createdAt !== 'string' || Number.isNaN(Date.parse(debt.createdAt))) {
      throw new DomainError('INVALID_DATE', 'Debt createdAt values must be valid ISO dates.', {
        debtId: debt.debtId,
        createdAt: debt.createdAt
      });
    }

    if (
      debt.balanceSource !== undefined &&
      debt.balanceSource !== 'user' &&
      debt.balanceSource !== 'estimated'
    ) {
      throw new DomainError('INVALID_MONEY', 'Debt balanceSource must be user or estimated.', {
        debtId: debt.debtId,
        balanceSource: debt.balanceSource
      });
    }
  }

  if (input.previousPayoffOrder !== undefined) {
    const previousIds = new Set(input.previousPayoffOrder);
    if (previousIds.size !== input.previousPayoffOrder.length) {
      throw new DomainError('INVALID_MONEY', 'previousPayoffOrder cannot contain duplicates.');
    }
  }

  return maximumMonths;
}

function ordersMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildInitialWarnings(
  orderedDebts: readonly ScenarioDebtInput[],
  previousPayoffOrder: readonly string[] | undefined
): ProjectionWarning[] {
  const warnings: ProjectionWarning[] = [];

  for (const debt of orderedDebts) {
    if (debt.aprBasisPoints === null) {
      warnings.push({
        code: 'UNKNOWN_APR',
        debtId: debt.debtId,
        message: `${debt.name} has no APR, so its projected interest is incomplete.`
      });
    }

    if (debt.balanceSource === 'estimated') {
      warnings.push({
        code: 'ESTIMATED_BALANCE',
        debtId: debt.debtId,
        message: `${debt.name} uses an estimated balance.`
      });
    }

    const firstInterest = calculateMonthlyInterest(debt.balanceMinor, debt.aprBasisPoints ?? 0);
    if (firstInterest >= debt.minimumPaymentMinor) {
      warnings.push({
        code: 'NEGATIVE_AMORTIZATION_AT_MINIMUM',
        debtId: debt.debtId,
        message: `${debt.name}'s minimum payment does not reduce its balance in the first projected month.`,
        details: {
          firstInterestMinor: firstInterest,
          minimumPaymentMinor: debt.minimumPaymentMinor
        }
      });
    }
  }

  const payoffOrder = orderedDebts.map((debt) => debt.debtId);
  if (previousPayoffOrder && !ordersMatch(previousPayoffOrder, payoffOrder)) {
    warnings.push({
      code: 'PAYOFF_ORDER_CHANGED',
      message: 'The payoff order changed after recalculating current balances.',
      details: { previousPayoffOrder: [...previousPayoffOrder], payoffOrder }
    });
  }

  return warnings;
}

function calculateMinimumOnlyComparison(
  debts: readonly ScenarioDebtInput[],
  startMonth: string,
  maximumMonths: number,
  planDurationMonths: number,
  planInterestMinor: number
): MinimumOnlyComparison {
  let longestDuration = 0;
  let totalInterestMinor = 0;
  const nonConvergingDebtIds: string[] = [];

  for (const debt of debts) {
    let balanceMinor = debt.balanceMinor;
    let debtInterestMinor = 0;
    let payoffDuration = 0;

    try {
      for (let monthIndex = 0; monthIndex < maximumMonths; monthIndex += 1) {
        const interestMinor = calculateMonthlyInterest(balanceMinor, debt.aprBasisPoints ?? 0);
        const balanceAfterInterest = checkedAdd(balanceMinor, interestMinor);
        const paymentMinor = capPayment(debt.minimumPaymentMinor, balanceAfterInterest);
        const closingBalanceMinor = checkedSubtract(balanceAfterInterest, paymentMinor);
        debtInterestMinor = checkedAdd(debtInterestMinor, interestMinor);
        balanceMinor = closingBalanceMinor;

        if (closingBalanceMinor === 0) {
          payoffDuration = monthIndex + 1;
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      payoffDuration = 0;
    }

    if (payoffDuration === 0) {
      nonConvergingDebtIds.push(debt.debtId);
      continue;
    }

    longestDuration = Math.max(longestDuration, payoffDuration);
    totalInterestMinor = checkedAdd(totalInterestMinor, debtInterestMinor);
  }

  if (nonConvergingDebtIds.length > 0) {
    return {
      status: 'unavailable',
      reason: 'NON_CONVERGING_DEBT',
      debtIds: nonConvergingDebtIds
    };
  }

  return {
    status: 'available',
    debtFreeMonth: addMonths(startMonth, longestDuration - 1),
    durationMonths: longestDuration,
    totalInterestMinor,
    monthsSaved: Math.max(0, longestDuration - planDurationMonths),
    interestSavedMinor: Math.max(0, totalInterestMinor - planInterestMinor)
  };
}

function buildMilestones(
  pending: readonly PendingMilestone[],
  months: readonly MonthlyProjection[]
): DebtMilestone[] {
  return pending.map((milestone) => {
    let nextTargetDebtId: string | null = null;
    let nextTargetPaymentMinor = 0;

    for (let index = milestone.payoffMonthNumber; index < months.length; index += 1) {
      const month = months[index];
      if (month.targetDebtId !== null && month.targetDebtId !== milestone.debtId) {
        nextTargetDebtId = month.targetDebtId;
        nextTargetPaymentMinor =
          month.debts.find((row) => row.debtId === month.targetDebtId)?.paymentMinor ?? 0;
        break;
      }
    }

    return { ...milestone, nextTargetDebtId, nextTargetPaymentMinor };
  });
}

function calculateValidatedPlan(
  input: CalculatePlanInput,
  orderedDebts: readonly ScenarioDebtInput[],
  maximumMonths: number
): CalculatePlanResult {
  const payoffOrder = orderedDebts.map((debt) => debt.debtId);
  const states = new Map<string, DebtState>(
    orderedDebts.map((debt) => [debt.debtId, { debt, balanceMinor: debt.balanceMinor }])
  );
  const months: MonthlyProjection[] = [];
  const pendingMilestones: PendingMilestone[] = [];
  const warnings = buildInitialWarnings(orderedDebts, input.previousPayoffOrder);
  let totalInterestMinor = 0;
  let totalPaidMinor = 0;

  for (let monthIndex = 0; monthIndex < maximumMonths; monthIndex += 1) {
    const activeStates = payoffOrder
      .map((debtId) => states.get(debtId))
      .filter((state): state is DebtState => state !== undefined && state.balanceMinor > 0);
    const targetDebtId = activeStates[0]?.debt.debtId ?? null;
    const openingBalances = new Map<string, number>();
    const interestByDebt = new Map<string, number>();
    const balancesAfterInterest = new Map<string, number>();
    const requiredPayments = new Map<string, number>();
    const payments = new Map<string, number>();

    for (const state of activeStates) {
      const { debt, balanceMinor } = state;
      openingBalances.set(debt.debtId, balanceMinor);
      const interestMinor = calculateMonthlyInterest(balanceMinor, debt.aprBasisPoints ?? 0);
      const balanceAfterInterest = checkedAdd(balanceMinor, interestMinor);
      const requiredPayment = capPayment(debt.minimumPaymentMinor, balanceAfterInterest);
      interestByDebt.set(debt.debtId, interestMinor);
      balancesAfterInterest.set(debt.debtId, balanceAfterInterest);
      requiredPayments.set(debt.debtId, requiredPayment);
      payments.set(debt.debtId, requiredPayment);
    }

    const totalRequiredPayments = sumMoney(requiredPayments.values());
    if (input.monthlyBudgetMinor < totalRequiredPayments) {
      return failure(
        'INSUFFICIENT_BUDGET',
        'The monthly budget does not cover this month’s required minimum payments.',
        {
          month: addMonths(input.startMonth, monthIndex),
          monthlyBudgetMinor: input.monthlyBudgetMinor,
          requiredPaymentsMinor: totalRequiredPayments,
          shortfallMinor: totalRequiredPayments - input.monthlyBudgetMinor
        }
      );
    }

    const balancesAfterMinimums = new Map<string, number>();
    for (const state of activeStates) {
      const debtId = state.debt.debtId;
      balancesAfterMinimums.set(
        debtId,
        checkedSubtract(balancesAfterInterest.get(debtId) ?? 0, requiredPayments.get(debtId) ?? 0)
      );
    }

    let remainingBudget = checkedSubtract(input.monthlyBudgetMinor, totalRequiredPayments);
    for (const debtId of payoffOrder) {
      if (remainingBudget === 0) break;
      const outstandingBalance = balancesAfterMinimums.get(debtId) ?? 0;
      if (outstandingBalance === 0) continue;
      const extraPayment = capPayment(remainingBudget, outstandingBalance);
      payments.set(debtId, checkedAdd(payments.get(debtId) ?? 0, extraPayment));
      balancesAfterMinimums.set(debtId, checkedSubtract(outstandingBalance, extraPayment));
      remainingBudget = checkedSubtract(remainingBudget, extraPayment);
    }

    const debtRows: MonthlyDebtProjection[] = [];
    for (const state of activeStates) {
      const debtId = state.debt.debtId;
      const openingBalanceMinor = openingBalances.get(debtId) ?? 0;
      const interestMinor = interestByDebt.get(debtId) ?? 0;
      const requiredPaymentMinor = requiredPayments.get(debtId) ?? 0;
      const paymentMinor = payments.get(debtId) ?? 0;
      const closingBalanceMinor = balancesAfterMinimums.get(debtId) ?? 0;
      const principalReductionMinor = openingBalanceMinor - closingBalanceMinor;

      state.balanceMinor = closingBalanceMinor;
      debtRows.push({
        debtId,
        name: state.debt.name,
        openingBalanceMinor,
        interestMinor,
        requiredPaymentMinor,
        paymentMinor,
        principalReductionMinor,
        closingBalanceMinor
      });

      if (openingBalanceMinor > 0 && closingBalanceMinor === 0) {
        pendingMilestones.push({
          debtId,
          name: state.debt.name,
          payoffMonth: addMonths(input.startMonth, monthIndex),
          payoffMonthNumber: monthIndex + 1,
          finalPaymentMinor: paymentMinor
        });
      }
    }

    const monthInterestMinor = sumMoney(debtRows.map((row) => row.interestMinor));
    const monthPaymentMinor = sumMoney(debtRows.map((row) => row.paymentMinor));
    totalInterestMinor = checkedAdd(totalInterestMinor, monthInterestMinor);
    totalPaidMinor = checkedAdd(totalPaidMinor, monthPaymentMinor);
    months.push({
      month: addMonths(input.startMonth, monthIndex),
      monthNumber: monthIndex + 1,
      targetDebtId,
      totalInterestMinor: monthInterestMinor,
      totalPaymentMinor: monthPaymentMinor,
      debts: debtRows
    });

    if ([...states.values()].every((state) => state.balanceMinor === 0)) {
      const durationMonths = monthIndex + 1;
      if (durationMonths > 360) {
        warnings.push({
          code: 'LONG_REPAYMENT_PERIOD',
          message: 'The projected repayment period is longer than 30 years.',
          details: { durationMonths }
        });
      }

      const projection: PlanProjection = {
        status: 'success',
        payoffOrder,
        startMonth: input.startMonth,
        debtFreeMonth: addMonths(input.startMonth, monthIndex),
        durationMonths,
        totalStartingBalanceMinor: sumMoney(orderedDebts.map((debt) => debt.balanceMinor)),
        totalInterestMinor,
        totalPaidMinor,
        hasIncompleteInterest: orderedDebts.some((debt) => debt.aprBasisPoints === null),
        warnings,
        milestones: buildMilestones(pendingMilestones, months),
        months,
        minimumOnlyComparison: calculateMinimumOnlyComparison(
          orderedDebts,
          input.startMonth,
          maximumMonths,
          durationMonths,
          totalInterestMinor
        )
      };

      return projection;
    }
  }

  return failure(
    'NON_CONVERGING',
    'The plan did not repay every debt within the simulation limit.',
    {
      maximumMonths,
      remainingBalances: payoffOrder.map((debtId) => ({
        debtId,
        balanceMinor: states.get(debtId)?.balanceMinor ?? 0
      }))
    }
  );
}

export function calculatePlan(input: CalculatePlanInput): CalculatePlanResult {
  if (!Array.isArray(input.debts) || input.debts.length === 0) {
    return failure('NO_DEBTS', 'Add at least one debt to calculate a payoff plan.');
  }

  try {
    const maximumMonths = validateInput(input);
    const orderedDebts = sortDebtInputs(input.debts);
    return calculateValidatedPlan(input, orderedDebts, maximumMonths);
  } catch (error) {
    if (error instanceof DomainError) {
      return failure('INVALID_INPUT', error.message, {
        domainCode: error.code,
        ...error.details
      });
    }
    throw error;
  }
}
