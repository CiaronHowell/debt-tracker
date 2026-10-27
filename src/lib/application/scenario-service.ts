import { z } from 'zod';
import {
  calculatePlan,
  type CalculatePlanResult,
  type PlanProjection,
  type ScenarioDebtInput,
  type StartMonthPayment
} from '$lib/domain';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import { scenarioFingerprint } from '$lib/persistence/fingerprint';
import type { Debt, Scenario } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import {
  identifierSchema,
  positiveMoneyMinorSchema,
  parsePlanSettings,
  parseScenario,
  yearMonthSchema
} from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { calculateScenarioProjection } from './plan-service';
import {
  aggregateStartMonthPayments,
  planStartMonth,
  sameStartMonthPayments
} from './plan-workspace';
import { resolveDependencies, type ServiceDependencies } from './service-utils';
import { validateInput } from './validation';

const scenarioDraftInputSchema = z.strictObject({
  monthlyBudgetMinor: positiveMoneyMinorSchema,
  startMonth: yearMonthSchema,
  algorithm: z.enum(['snowball', 'deadline-aware']).optional()
});

const renameScenarioInputSchema = z.strictObject({
  scenarioId: identifierSchema,
  name: z.string().trim().min(1).max(80)
});

const createScenarioInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(80),
  monthlyBudgetMinor: positiveMoneyMinorSchema,
  startMonth: yearMonthSchema,
  algorithm: z.enum(['snowball', 'deadline-aware']).optional(),
  sourceScenarioId: identifierSchema.nullable().optional()
});

export type CreateScenarioInput = z.infer<typeof createScenarioInputSchema>;
export type PreviewScenarioInput = z.infer<typeof scenarioDraftInputSchema>;

export interface SavedScenarioView {
  scenario: Scenario;
  projection: PlanProjection;
  isStale: boolean;
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

export class ScenarioService {
  private readonly repositories;
  private readonly dependencies: ServiceDependencies;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.repositories = createRepositories(database);
    this.dependencies = resolveDependencies(dependencies);
  }

  private async currentDebtSnapshot(): Promise<ScenarioDebtInput[]> {
    const debts = await this.repositories.debts.active();
    return debts.filter((debt) => debt.currentBalanceMinor > 0).map(debtToScenarioInput);
  }

  private async paymentsMadeIn(month: string): Promise<StartMonthPayment[]> {
    return aggregateStartMonthPayments(await this.repositories.payments.inMonth(month));
  }

  /** Stale when balances changed or payments in the plan's first month were added or removed. */
  private async scenarioIsStale(scenario: Scenario, currentFingerprint: string): Promise<boolean> {
    const [savedFingerprint, startMonthPayments] = await Promise.all([
      scenarioFingerprint(scenario.debtSnapshot),
      this.paymentsMadeIn(scenario.startMonth)
    ]);
    return (
      savedFingerprint !== currentFingerprint ||
      !sameStartMonthPayments(scenario.startMonthPayments, startMonthPayments)
    );
  }

  async list(): Promise<Scenario[]> {
    const scenarios = await this.repositories.scenarios.all();
    return scenarios.sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt)
    );
  }

  async workspace(): Promise<SavedScenarioView[]> {
    const settings = await this.repositories.planSettings.primary();
    if (!settings) throw new AppError('VALIDATION_FAILED', 'Plan settings are missing.');
    const [scenarios, currentFingerprint] = await Promise.all([
      this.list(),
      this.currentDebtSnapshot().then(scenarioFingerprint)
    ]);

    return Promise.all(
      scenarios.map(async (scenario) => ({
        scenario,
        projection: calculateScenarioProjection(settings, scenario),
        isStale: await this.scenarioIsStale(scenario, currentFingerprint)
      }))
    );
  }

  async preview(input: PreviewScenarioInput): Promise<CalculatePlanResult> {
    const valid = validateInput(scenarioDraftInputSchema, input);
    const settings = await this.repositories.planSettings.primary();
    if (!settings) throw new AppError('VALIDATION_FAILED', 'Plan settings are missing.');
    return calculatePlan({
      currency: settings.currency,
      startMonth: valid.startMonth,
      monthlyBudgetMinor: valid.monthlyBudgetMinor,
      algorithm: valid.algorithm ?? 'snowball',
      debts: await this.currentDebtSnapshot(),
      startMonthPayments: await this.paymentsMadeIn(valid.startMonth)
    });
  }

  async rename(scenarioId: string, name: string): Promise<Scenario> {
    const valid = validateInput(renameScenarioInputSchema, { scenarioId, name });
    try {
      return await runWriteTransaction(
        this.database,
        [this.database.scenarios],
        async () => {
          const scenario = await this.repositories.scenarios.get(valid.scenarioId);
          if (!scenario) {
            throw new AppError('VALIDATION_FAILED', 'The selected scenario no longer exists.');
          }
          const renamed = parseScenario({
            ...scenario,
            name: valid.name,
            updatedAt: this.dependencies.now()
          });
          await this.repositories.scenarios.put(renamed);
          return renamed;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async create(input: CreateScenarioInput): Promise<Scenario> {
    const valid = validateInput(createScenarioInputSchema, input);
    const settings = await this.repositories.planSettings.primary();
    if (!settings) {
      throw new AppError('VALIDATION_FAILED', 'Save plan settings before creating a scenario.');
    }
    const debtSnapshot = await this.currentDebtSnapshot();
    const startMonthPayments = await this.paymentsMadeIn(valid.startMonth);
    const now = this.dependencies.now();
    const scenario = parseScenario({
      id: this.dependencies.createId(),
      name: valid.name,
      monthlyBudgetMinor: valid.monthlyBudgetMinor,
      startMonth: valid.startMonth,
      algorithm: valid.algorithm ?? 'snowball',
      debtSnapshot,
      startMonthPayments,
      sourceScenarioId: valid.sourceScenarioId ?? null,
      createdAt: now,
      updatedAt: now
    });
    calculateScenarioProjection(settings, scenario);

    try {
      await runWriteTransaction(
        this.database,
        [this.database.scenarios],
        async () => this.repositories.scenarios.add(scenario),
        this.dependencies.now
      );
      return scenario;
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async createAndActivate(input: CreateScenarioInput): Promise<Scenario> {
    const valid = validateInput(createScenarioInputSchema, input);
    const settings = await this.repositories.planSettings.primary();
    if (!settings) {
      throw new AppError('VALIDATION_FAILED', 'Save plan settings before activating a scenario.');
    }
    const debtSnapshot = await this.currentDebtSnapshot();
    const startMonthPayments = await this.paymentsMadeIn(valid.startMonth);
    const now = this.dependencies.now();
    const scenario = parseScenario({
      id: this.dependencies.createId(),
      name: valid.name,
      monthlyBudgetMinor: valid.monthlyBudgetMinor,
      startMonth: valid.startMonth,
      algorithm: valid.algorithm ?? 'snowball',
      debtSnapshot,
      startMonthPayments,
      sourceScenarioId: valid.sourceScenarioId ?? null,
      createdAt: now,
      updatedAt: now
    });
    calculateScenarioProjection(settings, scenario);

    try {
      await runWriteTransaction(
        this.database,
        [this.database.scenarios, this.database.planSettings],
        async () => {
          await this.repositories.scenarios.add(scenario);
          await this.repositories.planSettings.put(
            parsePlanSettings({
              ...settings,
              monthlyBudgetMinor: scenario.monthlyBudgetMinor,
              startMonth: scenario.startMonth,
              activeScenarioId: scenario.id,
              setupCompletedAt: now,
              updatedAt: now
            })
          );
        },
        this.dependencies.now
      );
      return scenario;
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
  async isStale(scenarioId: string): Promise<boolean> {
    const validId = validateInput(identifierSchema, scenarioId);
    const scenario = await this.repositories.scenarios.get(validId);
    if (!scenario)
      throw new AppError('VALIDATION_FAILED', 'The selected scenario no longer exists.');
    const currentFingerprint = await scenarioFingerprint(await this.currentDebtSnapshot());
    return this.scenarioIsStale(scenario, currentFingerprint);
  }

  /**
   * Updates a saved plan in place with current balances. When `currentMonth` is given, a plan
   * that started in an earlier month is moved forward to start in `currentMonth`.
   */
  async refresh(scenarioId: string, currentMonth?: string): Promise<Scenario> {
    const validId = validateInput(identifierSchema, scenarioId);
    const validMonth =
      currentMonth === undefined ? undefined : validateInput(yearMonthSchema, currentMonth);
    const settings = await this.repositories.planSettings.primary();
    if (!settings) throw new AppError('VALIDATION_FAILED', 'Plan settings are missing.');
    const debtSnapshot = await this.currentDebtSnapshot();

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.scenarios, this.database.planSettings, this.database.payments],
        async () => {
          const existing = await this.repositories.scenarios.get(validId);
          if (!existing) {
            throw new AppError('VALIDATION_FAILED', 'The selected scenario no longer exists.');
          }
          const now = this.dependencies.now();
          const startMonth = validMonth
            ? planStartMonth(existing.startMonth, validMonth)
            : existing.startMonth;
          const refreshed = parseScenario({
            ...existing,
            startMonth,
            debtSnapshot,
            startMonthPayments: await this.paymentsMadeIn(startMonth),
            updatedAt: now
          });
          calculateScenarioProjection(settings, refreshed);
          await this.repositories.scenarios.put(refreshed);

          const currentSettings = await this.repositories.planSettings.primary();
          if (
            currentSettings?.activeScenarioId === refreshed.id &&
            currentSettings.startMonth !== startMonth
          ) {
            await this.repositories.planSettings.put(
              parsePlanSettings({ ...currentSettings, startMonth, updatedAt: now })
            );
          }
          return refreshed;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async activate(scenarioId: string): Promise<Scenario> {
    const validId = validateInput(identifierSchema, scenarioId);
    if (await this.isStale(validId)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Refresh this saved plan with current balances before making it active.'
      );
    }

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.scenarios, this.database.planSettings],
        async () => {
          const [scenario, settings] = await Promise.all([
            this.repositories.scenarios.get(validId),
            this.repositories.planSettings.primary()
          ]);
          if (!scenario || !settings) {
            throw new AppError('VALIDATION_FAILED', 'The scenario or plan settings are missing.');
          }
          calculateScenarioProjection(settings, scenario);
          const now = this.dependencies.now();
          await this.repositories.planSettings.put(
            parsePlanSettings({
              ...settings,
              monthlyBudgetMinor: scenario.monthlyBudgetMinor,
              startMonth: scenario.startMonth,
              activeScenarioId: scenario.id,
              setupCompletedAt: settings.setupCompletedAt ?? now,
              updatedAt: now
            })
          );
          return scenario;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
