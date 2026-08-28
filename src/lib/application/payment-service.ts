import { z } from 'zod';
import { sumMoney } from '$lib/domain/money';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import type { Payment } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import {
  calendarDateSchema,
  identifierSchema,
  positiveMoneyMinorSchema,
  parseBalanceSnapshot,
  parseDebt,
  parsePayment
} from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { resolveDependencies, type ServiceDependencies } from './service-utils';
import { validateInput } from './validation';

const recordPaymentInputSchema = z.strictObject({
  debtId: identifierSchema,
  amountMinor: positiveMoneyMinorSchema,
  paidOn: calendarDateSchema,
  note: z.string().max(2_000)
});

export type RecordPaymentInput = z.infer<typeof recordPaymentInputSchema>;

export interface PaymentHistorySummary {
  recent: Payment[];
  totalPaidMinor: number;
}

export class PaymentService {
  private readonly repositories;
  private readonly dependencies: ServiceDependencies;

  constructor(
    private readonly database: DebtTrackerDatabase,
    dependencies: Partial<ServiceDependencies> = {}
  ) {
    this.repositories = createRepositories(database);
    this.dependencies = resolveDependencies(dependencies);
  }

  async history(limit = 5): Promise<PaymentHistorySummary> {
    const payments = await this.repositories.payments.all();
    payments.sort((left, right) => {
      const byDate = right.paidOn.localeCompare(left.paidOn);
      if (byDate !== 0) return byDate;
      const byCreated = right.createdAt.localeCompare(left.createdAt);
      return byCreated !== 0 ? byCreated : right.id.localeCompare(left.id);
    });
    return {
      recent: payments.slice(0, Math.max(0, limit)),
      totalPaidMinor: sumMoney(payments.map((payment) => payment.amountMinor))
    };
  }

  async record(input: RecordPaymentInput): Promise<Payment> {
    const valid = validateInput(recordPaymentInputSchema, input);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.debts, this.database.payments, this.database.balanceSnapshots],
        async () => {
          const debt = await this.repositories.debts.get(valid.debtId);
          if (!debt || debt.archivedAt !== null) {
            throw new AppError('VALIDATION_FAILED', 'The selected debt is not active.');
          }

          const now = this.dependencies.now();
          const estimatedBalanceAfterMinor = Math.max(
            0,
            debt.currentBalanceMinor - valid.amountMinor
          );
          const payment = parsePayment({
            id: this.dependencies.createId(),
            debtId: debt.id,
            amountMinor: valid.amountMinor,
            paidOn: valid.paidOn,
            note: valid.note,
            balanceBeforeMinor: debt.currentBalanceMinor,
            estimatedBalanceAfterMinor,
            createdAt: now
          });
          const updatedDebt = parseDebt({
            ...debt,
            currentBalanceMinor: estimatedBalanceAfterMinor,
            balanceAsOf: valid.paidOn,
            balanceSource: 'estimated',
            updatedAt: now
          });
          const snapshot = parseBalanceSnapshot({
            id: this.dependencies.createId(),
            debtId: debt.id,
            balanceMinor: estimatedBalanceAfterMinor,
            recordedOn: valid.paidOn,
            source: 'payment-estimate',
            createdAt: now
          });

          await this.repositories.debts.put(updatedDebt);
          await this.repositories.payments.add(payment);
          await this.repositories.balanceSnapshots.add(snapshot);
          return payment;
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
