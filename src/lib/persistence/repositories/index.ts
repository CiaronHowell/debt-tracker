import type { EntityTable, IDType } from 'dexie';
import type { DebtTrackerDatabase } from '../db';
import type {
  AppMeta,
  BalanceSnapshot,
  Debt,
  Payment,
  PayLaterPayment,
  PayLaterPlan,
  PlanSettings,
  Scenario
} from '../models';
import {
  parseAppMeta,
  parseBalanceSnapshot,
  parseDebt,
  parsePayment,
  parsePayLaterPayment,
  parsePayLaterPlan,
  parsePlanSettings,
  parseScenario
} from '../schemas';

class EntityRepository<T extends object, KeyProperty extends keyof T> {
  constructor(
    protected readonly table: EntityTable<T, KeyProperty>,
    private readonly parse: (value: unknown) => T
  ) {}

  async get(key: IDType<T, KeyProperty>): Promise<T | undefined> {
    const value = await this.table.get(key);
    return value === undefined ? undefined : this.parse(value);
  }

  async add(value: T): Promise<void> {
    await this.table.add(this.parse(value));
  }

  async put(value: T): Promise<void> {
    await this.table.put(this.parse(value));
  }

  async all(): Promise<T[]> {
    return (await this.table.toArray()).map(this.parse);
  }

  async delete(key: IDType<T, KeyProperty>): Promise<void> {
    await this.table.delete(key);
  }
}

export class DebtRepository extends EntityRepository<Debt, 'id'> {
  constructor(table: EntityTable<Debt, 'id'>) {
    super(table, parseDebt);
  }

  async active(): Promise<Debt[]> {
    const debts = await this.all();
    return debts
      .filter((debt) => debt.archivedAt === null)
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt)
      );
  }
}

export class PlanSettingsRepository extends EntityRepository<PlanSettings, 'id'> {
  constructor(table: EntityTable<PlanSettings, 'id'>) {
    super(table, parsePlanSettings);
  }

  primary(): Promise<PlanSettings | undefined> {
    return this.get('primary');
  }
}

export class ScenarioRepository extends EntityRepository<Scenario, 'id'> {
  constructor(table: EntityTable<Scenario, 'id'>) {
    super(table, parseScenario);
  }
}

export class PaymentRepository extends EntityRepository<Payment, 'id'> {
  constructor(table: EntityTable<Payment, 'id'>) {
    super(table, parsePayment);
  }

  async forDebt(debtId: string): Promise<Payment[]> {
    const payments = await this.table.where('debtId').equals(debtId).sortBy('paidOn');
    return payments.map(parsePayment);
  }
}

export class PayLaterPlanRepository extends EntityRepository<PayLaterPlan, 'id'> {
  constructor(table: EntityTable<PayLaterPlan, 'id'>) {
    super(table, parsePayLaterPlan);
  }

  async active(): Promise<PayLaterPlan[]> {
    const plans = await this.all();
    return plans
      .filter((plan) => plan.archivedAt === null)
      .sort((left, right) => {
        const byDeadline = left.deadlineDate.localeCompare(right.deadlineDate);
        return byDeadline !== 0 ? byDeadline : left.id.localeCompare(right.id);
      });
  }
}

export class PayLaterPaymentRepository extends EntityRepository<PayLaterPayment, 'id'> {
  constructor(table: EntityTable<PayLaterPayment, 'id'>) {
    super(table, parsePayLaterPayment);
  }

  async forPlan(planId: string): Promise<PayLaterPayment[]> {
    const payments = await this.table.where('planId').equals(planId).sortBy('paidOn');
    return payments.map(parsePayLaterPayment);
  }
}

export class BalanceSnapshotRepository extends EntityRepository<BalanceSnapshot, 'id'> {
  constructor(table: EntityTable<BalanceSnapshot, 'id'>) {
    super(table, parseBalanceSnapshot);
  }
}

export class AppMetaRepository extends EntityRepository<AppMeta, 'key'> {
  constructor(table: EntityTable<AppMeta, 'key'>) {
    super(table, parseAppMeta);
  }
}

export interface Repositories {
  debts: DebtRepository;
  planSettings: PlanSettingsRepository;
  scenarios: ScenarioRepository;
  payments: PaymentRepository;
  payLaterPlans: PayLaterPlanRepository;
  payLaterPayments: PayLaterPaymentRepository;
  balanceSnapshots: BalanceSnapshotRepository;
  appMeta: AppMetaRepository;
}

export function createRepositories(database: DebtTrackerDatabase): Repositories {
  return {
    debts: new DebtRepository(database.debts),
    planSettings: new PlanSettingsRepository(database.planSettings),
    scenarios: new ScenarioRepository(database.scenarios),
    payments: new PaymentRepository(database.payments),
    payLaterPlans: new PayLaterPlanRepository(database.payLaterPlans),
    payLaterPayments: new PayLaterPaymentRepository(database.payLaterPayments),
    balanceSnapshots: new BalanceSnapshotRepository(database.balanceSnapshots),
    appMeta: new AppMetaRepository(database.appMeta)
  };
}
