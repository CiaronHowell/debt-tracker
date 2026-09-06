import { z } from 'zod';
import { calculatePayLaterSchedule, type PayLaterSchedule } from '$lib/domain';
import { sumMoney } from '$lib/domain/money';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import type { PayLaterPayment, PayLaterPlan } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import {
  aprBasisPointsSchema,
  calendarDateSchema,
  identifierSchema,
  moneyMinorSchema,
  positiveMoneyMinorSchema,
  parsePayLaterPayment,
  parsePayLaterPlan
} from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { resolveDependencies, type ServiceDependencies } from './service-utils';
import { validateInput } from './validation';

const planFields = {
  name: z.string().trim().min(1).max(80),
  purchaseDate: calendarDateSchema,
  deadlineDate: calendarDateSchema,
  missedDeadlineAprBasisPoints: aprBasisPointsSchema.nullable(),
  notes: z.string().max(2_000)
} as const;

const createPayLaterPlanInputSchema = z
  .strictObject({ ...planFields, startingBalanceMinor: positiveMoneyMinorSchema })
  .refine((plan) => plan.deadlineDate >= plan.purchaseDate, {
    message: 'Choose a deadline on or after the purchase date.',
    path: ['deadlineDate']
  });

const updatePayLaterPlanInputSchema = z
  .strictObject({ ...planFields, currentBalanceMinor: moneyMinorSchema })
  .refine((plan) => plan.deadlineDate >= plan.purchaseDate, {
    message: 'Choose a deadline on or after the purchase date.',
    path: ['deadlineDate']
  });

const recordPayLaterPaymentInputSchema = z.strictObject({
  planId: identifierSchema,
  amountMinor: positiveMoneyMinorSchema,
  paidOn: calendarDateSchema,
  note: z.string().max(2_000)
});

export type CreatePayLaterPlanInput = z.input<typeof createPayLaterPlanInputSchema>;
export type UpdatePayLaterPlanInput = z.input<typeof updatePayLaterPlanInputSchema>;
export type RecordPayLaterPaymentInput = z.input<typeof recordPayLaterPaymentInputSchema>;

export interface PayLaterPlanView {
  plan: PayLaterPlan;
  schedule: PayLaterSchedule;
}

export interface PayLaterSummary {
  plans: PayLaterPlanView[];
  totalBalanceMinor: number;
  monthlyAllocationMinor: number;
  overdueCount: number;
}

export class PayLaterService {
  private readonly repositories;
  private readonly dependencies: ServiceDependencies;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.repositories = createRepositories(database);
    this.dependencies = resolveDependencies(dependencies);
  }

  async workspace(asOfDate: string): Promise<PayLaterPlanView[]> {
    const validDate = validateInput(calendarDateSchema, asOfDate);
    const plans = await this.repositories.payLaterPlans.active();
    return plans.map((plan) => ({
      plan,
      schedule: calculatePayLaterSchedule({
        startingBalanceMinor: plan.startingBalanceMinor,
        currentBalanceMinor: plan.currentBalanceMinor,
        purchaseDate: plan.purchaseDate,
        deadlineDate: plan.deadlineDate,
        asOfDate: validDate
      })
    }));
  }

  async summary(asOfDate: string): Promise<PayLaterSummary> {
    const plans = await this.workspace(asOfDate);
    return {
      plans,
      totalBalanceMinor: sumMoney(plans.map(({ plan }) => plan.currentBalanceMinor)),
      monthlyAllocationMinor: sumMoney(plans.map(({ schedule }) => schedule.monthlyTargetMinor)),
      overdueCount: plans.filter(({ schedule }) => schedule.status === 'overdue').length
    };
  }

  async create(input: CreatePayLaterPlanInput): Promise<PayLaterPlan> {
    const valid = validateInput(createPayLaterPlanInputSchema, input);
    const now = this.dependencies.now();
    const plan = parsePayLaterPlan({
      id: this.dependencies.createId(),
      ...valid,
      currentBalanceMinor: valid.startingBalanceMinor,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    });

    try {
      await runWriteTransaction(
        this.database,
        [this.database.payLaterPlans],
        () => this.repositories.payLaterPlans.add(plan),
        this.dependencies.now
      );
      return plan;
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async update(planId: string, input: UpdatePayLaterPlanInput): Promise<PayLaterPlan> {
    const validId = validateInput(identifierSchema, planId);
    const valid = validateInput(updatePayLaterPlanInputSchema, input);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.payLaterPlans],
        async () => {
          const existing = await this.repositories.payLaterPlans.get(validId);
          if (!existing || existing.archivedAt !== null) {
            throw new AppError('VALIDATION_FAILED', 'The selected pay-later plan is not active.');
          }
          const updated = parsePayLaterPlan({
            ...existing,
            ...valid,
            id: existing.id,
            updatedAt: this.dependencies.now()
          });
          await this.repositories.payLaterPlans.put(updated);
          return updated;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async archive(planId: string): Promise<PayLaterPlan> {
    const validId = validateInput(identifierSchema, planId);
    try {
      return await runWriteTransaction(
        this.database,
        [this.database.payLaterPlans],
        async () => {
          const existing = await this.repositories.payLaterPlans.get(validId);
          if (!existing) {
            throw new AppError(
              'VALIDATION_FAILED',
              'The selected pay-later plan no longer exists.'
            );
          }
          const now = this.dependencies.now();
          const archived = parsePayLaterPlan({ ...existing, archivedAt: now, updatedAt: now });
          await this.repositories.payLaterPlans.put(archived);
          return archived;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async recordPayment(input: RecordPayLaterPaymentInput): Promise<PayLaterPayment> {
    const valid = validateInput(recordPayLaterPaymentInputSchema, input);
    try {
      return await runWriteTransaction(
        this.database,
        [this.database.payLaterPlans, this.database.payLaterPayments],
        async () => {
          const plan = await this.repositories.payLaterPlans.get(valid.planId);
          if (!plan || plan.archivedAt !== null) {
            throw new AppError('VALIDATION_FAILED', 'The selected pay-later plan is not active.');
          }
          if (valid.paidOn < plan.purchaseDate) {
            throw new AppError(
              'VALIDATION_FAILED',
              'The payment date cannot be before the purchase date.'
            );
          }

          const now = this.dependencies.now();
          const balanceAfterMinor = Math.max(0, plan.currentBalanceMinor - valid.amountMinor);
          const payment = parsePayLaterPayment({
            id: this.dependencies.createId(),
            ...valid,
            balanceBeforeMinor: plan.currentBalanceMinor,
            balanceAfterMinor,
            createdAt: now
          });
          const updated = parsePayLaterPlan({
            ...plan,
            currentBalanceMinor: balanceAfterMinor,
            updatedAt: now
          });
          await this.repositories.payLaterPayments.add(payment);
          await this.repositories.payLaterPlans.put(updated);
          return payment;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
