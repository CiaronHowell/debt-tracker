import { z } from 'zod';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import type { BalanceSnapshot, Debt } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import {
  aprBasisPointsSchema,
  calendarDateSchema,
  identifierSchema,
  moneyMinorSchema,
  positiveMoneyMinorSchema,
  parseBalanceSnapshot,
  parseDebt
} from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { resolveDependencies, type ServiceDependencies } from './service-utils';
import { validateInput } from './validation';

const editableDebtFields = {
  name: z.string().trim().min(1).max(80),
  type: z.enum(['credit-card', 'loan', 'overdraft', 'other']),
  aprBasisPoints: aprBasisPointsSchema.nullable(),
  minimumPaymentMinor: positiveMoneyMinorSchema,
  dueDay: z.number().int().min(1).max(31).nullable(),
  notes: z.string().max(2_000),
  colorKey: z.string().min(1).max(64).nullable()
} as const;

const createDebtInputSchema = z.strictObject({
  ...editableDebtFields,
  startingBalanceMinor: positiveMoneyMinorSchema,
  balanceAsOf: calendarDateSchema
});

const updateDebtInputSchema = z.strictObject(editableDebtFields);
const reconcileBalanceInputSchema = z.strictObject({
  debtId: identifierSchema,
  balanceMinor: moneyMinorSchema,
  recordedOn: calendarDateSchema,
  source: z.enum(['statement', 'manual-correction'])
});

type CreateDebtInput = z.infer<typeof createDebtInputSchema>;
type UpdateDebtInput = z.infer<typeof updateDebtInputSchema>;
type ReconcileBalanceInput = z.infer<typeof reconcileBalanceInputSchema>;

export class DebtService {
  private readonly repositories;
  private readonly dependencies: ServiceDependencies;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.repositories = createRepositories(database);
    this.dependencies = resolveDependencies(dependencies);
  }

  listActive(): Promise<Debt[]> {
    return this.repositories.debts.active();
  }

  get(debtId: string): Promise<Debt | undefined> {
    return this.repositories.debts.get(debtId);
  }

  async create(input: CreateDebtInput): Promise<Debt> {
    const valid = validateInput(createDebtInputSchema, input);
    const now = this.dependencies.now();
    const debt = parseDebt({
      id: this.dependencies.createId(),
      ...valid,
      currentBalanceMinor: valid.startingBalanceMinor,
      balanceSource: 'user',
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    });
    const snapshot = parseBalanceSnapshot({
      id: this.dependencies.createId(),
      debtId: debt.id,
      balanceMinor: debt.currentBalanceMinor,
      recordedOn: debt.balanceAsOf,
      source: 'setup',
      createdAt: now
    });

    try {
      await runWriteTransaction(
        this.database,
        [this.database.debts, this.database.balanceSnapshots],
        async () => {
          await this.repositories.debts.add(debt);
          await this.repositories.balanceSnapshots.add(snapshot);
        },
        this.dependencies.now
      );
      return debt;
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async update(debtId: string, input: UpdateDebtInput): Promise<Debt> {
    const validId = validateInput(identifierSchema, debtId);
    const valid = validateInput(updateDebtInputSchema, input);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.debts],
        async () => {
          const existing = await this.repositories.debts.get(validId);
          if (!existing) {
            throw new AppError('VALIDATION_FAILED', 'The selected debt no longer exists.');
          }
          const updated = parseDebt({
            ...existing,
            ...valid,
            id: existing.id,
            updatedAt: this.dependencies.now()
          });
          await this.repositories.debts.put(updated);
          return updated;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async archive(debtId: string): Promise<Debt> {
    const validId = validateInput(identifierSchema, debtId);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.debts],
        async () => {
          const existing = await this.repositories.debts.get(validId);
          if (!existing) {
            throw new AppError('VALIDATION_FAILED', 'The selected debt no longer exists.');
          }
          const now = this.dependencies.now();
          const archived = parseDebt({ ...existing, archivedAt: now, updatedAt: now });
          await this.repositories.debts.put(archived);
          return archived;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }

  async reconcileBalance(input: ReconcileBalanceInput): Promise<Debt> {
    const valid = validateInput(reconcileBalanceInputSchema, input);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.debts, this.database.balanceSnapshots],
        async () => {
          const existing = await this.repositories.debts.get(valid.debtId);
          if (!existing) {
            throw new AppError('VALIDATION_FAILED', 'The selected debt no longer exists.');
          }
          const now = this.dependencies.now();
          const updated = parseDebt({
            ...existing,
            currentBalanceMinor: valid.balanceMinor,
            balanceAsOf: valid.recordedOn,
            balanceSource: 'user',
            updatedAt: now
          });
          const snapshot: BalanceSnapshot = parseBalanceSnapshot({
            id: this.dependencies.createId(),
            debtId: existing.id,
            balanceMinor: valid.balanceMinor,
            recordedOn: valid.recordedOn,
            source: valid.source,
            createdAt: now
          });
          await this.repositories.debts.put(updated);
          await this.repositories.balanceSnapshots.add(snapshot);
          return updated;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
