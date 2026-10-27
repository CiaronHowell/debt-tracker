import { z } from 'zod';
import {
  calculatePlan,
  type CalculationFailure,
  type PlanProjection,
  type ScenarioDebtInput,
  type StartMonthPayment
} from '$lib/domain';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import { scenarioFingerprint } from '$lib/persistence/fingerprint';
import type { Debt, PlanSettings, Scenario } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import { moneyMinorSchema, parsePlanSettings, yearMonthSchema } from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { comparePlanProjections, type PlanProjectionComparison } from './plan-comparison';
import {
  aggregateStartMonthPayments,
  planStartMonth,
  sameStartMonthPayments
} from './plan-workspace';
import { resolveDependencies, type ServiceDependencies } from './service-utils';
import { validateInput } from './validation';

const savePlanSettingsInputSchema = z.strictObject({
  currency: z.enum(['GBP', 'EUR', 'USD']),
  startMonth: yearMonthSchema,
  monthlyBudgetMinor: moneyMinorSchema
});

export type SavePlanSettingsInput = z.infer<typeof savePlanSettingsInputSchema>;

export interface ActivePlanReview {
  scenario: Scenario;
  activeProjection: PlanProjection;
  currentProjection: PlanProjection | null;
  /** Start month for a replacement plan generated from current balances. */
  currentStartMonth: string;
  currentFailure: CalculationFailure | null;
  isStale: boolean;
  comparison: PlanProjectionComparison | null;
}

function debtToScenarioInput(debt: Debt): ScenarioDebtInput {
  return {
    debtId: debt.id,
    name: debt.name,
    balanceMinor: debt.currentBalanceMinor,
    aprBasisPoints: debt.aprBasisPoints,
    promotionalAprEndsOn: debt.promotionalAprEndsOn,
    minimumPaymentMinor: debt.minimumPaymentMinor,
    createdAt: debt.createdAt,
    balanceSource: debt.balanceSource
  };
}

export function calculateScenarioProjection(
  settings: PlanSettings,
  scenario: Scenario
): PlanProjection {
  const result = calculatePlan({
    currency: settings.currency,
    startMonth: scenario.startMonth,
    monthlyBudgetMinor: scenario.monthlyBudgetMinor,
    algorithm: scenario.algorithm,
    debts: scenario.debtSnapshot,
    startMonthPayments: scenario.startMonthPayments
  });

  if (result.status === 'success') return result;
  if (result.code === 'INSUFFICIENT_BUDGET') {
    throw new AppError('INSUFFICIENT_BUDGET', result.message, result.details);
  }
  if (result.code === 'NON_CONVERGING') {
    throw new AppError('NON_CONVERGING_PLAN', result.message, result.details);
  }
  throw new AppError('VALIDATION_FAILED', 'The saved plan contains invalid inputs.', {
    calculationCode: result.code
  });
}

export class PlanService {
  private readonly repositories;
  private readonly dependencies: ServiceDependencies;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.repositories = createRepositories(database);
    this.dependencies = resolveDependencies(dependencies);
  }

  private async paymentsMadeIn(month: string): Promise<StartMonthPayment[]> {
    return aggregateStartMonthPayments(await this.repositories.payments.inMonth(month));
  }

  getSettings(): Promise<PlanSettings | undefined> {
    return this.repositories.planSettings.primary();
  }

  async saveSettings(input: SavePlanSettingsInput): Promise<PlanSettings> {
    const valid = validateInput(savePlanSettingsInputSchema, input);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.planSettings],
        async () => {
          const existing = await this.repositories.planSettings.primary();
          const settings = parsePlanSettings({
            id: 'primary',
            ...valid,
            activeScenarioId: existing?.activeScenarioId ?? null,
            setupCompletedAt: existing?.setupCompletedAt ?? null,
            updatedAt: this.dependencies.now()
          });
          await this.repositories.planSettings.put(settings);
          return settings;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async getActiveProjection(): Promise<PlanProjection | null> {
    const settings = await this.repositories.planSettings.primary();
    if (!settings?.activeScenarioId) return null;
    const scenario = await this.repositories.scenarios.get(settings.activeScenarioId);
    if (!scenario) {
      throw new AppError('VALIDATION_FAILED', 'The active plan snapshot is missing.');
    }
    return calculateScenarioProjection(settings, scenario);
  }

  async getActivePlanReview(currentMonth?: string): Promise<ActivePlanReview | null> {
    const settings = await this.repositories.planSettings.primary();
    if (!settings?.activeScenarioId) return null;
    const scenario = await this.repositories.scenarios.get(settings.activeScenarioId);
    if (!scenario) {
      throw new AppError('VALIDATION_FAILED', 'The active plan snapshot is missing.');
    }

    const activeProjection = calculateScenarioProjection(settings, scenario);
    const currentDebts = (await this.repositories.debts.active())
      .filter((debt) => debt.currentBalanceMinor > 0)
      .map(debtToScenarioInput);
    const currentStartMonth = currentMonth
      ? planStartMonth(scenario.startMonth, currentMonth)
      : scenario.startMonth;
    const [savedFingerprint, currentFingerprint, scenarioMonthPayments, currentMonthPayments] =
      await Promise.all([
        scenarioFingerprint(scenario.debtSnapshot),
        scenarioFingerprint(currentDebts),
        this.paymentsMadeIn(scenario.startMonth),
        this.paymentsMadeIn(currentStartMonth)
      ]);
    // A payment added or removed in the plan's first month changes what is left to pay.
    const isStale =
      savedFingerprint !== currentFingerprint ||
      !sameStartMonthPayments(scenario.startMonthPayments, scenarioMonthPayments);

    if (!isStale) {
      return {
        scenario,
        activeProjection,
        currentProjection: activeProjection,
        currentStartMonth,
        currentFailure: null,
        isStale: false,
        comparison: null
      };
    }

    const currentResult = calculatePlan({
      currency: settings.currency,
      startMonth: currentStartMonth,
      monthlyBudgetMinor: scenario.monthlyBudgetMinor,
      algorithm: scenario.algorithm,
      debts: currentDebts,
      previousPayoffOrder: activeProjection.payoffOrder,
      startMonthPayments: currentMonthPayments
    });
    if (currentResult.status === 'failure') {
      return {
        scenario,
        activeProjection,
        currentProjection: null,
        currentStartMonth,
        currentFailure: currentResult,
        isStale: true,
        comparison: null
      };
    }

    return {
      scenario,
      activeProjection,
      currentProjection: currentResult,
      currentStartMonth,
      currentFailure: null,
      isStale: true,
      comparison: comparePlanProjections(activeProjection, currentResult)
    };
  }
}
