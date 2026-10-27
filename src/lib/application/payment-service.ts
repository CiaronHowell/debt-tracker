import { z } from 'zod';
import type { StartMonthPayment } from '$lib/domain';
import { checkedAdd, checkedSubtract, sumMoney } from '$lib/domain/money';
import type { DebtTrackerDatabase } from '$lib/persistence/db';
import type { BalanceSnapshot, Payment } from '$lib/persistence/models';
import { createRepositories } from '$lib/persistence/repositories';
import {
  calendarDateSchema,
  identifierSchema,
  yearMonthSchema,
  positiveMoneyMinorSchema,
  parseBalanceSnapshot,
  parseDebt,
  parsePayment
} from '$lib/persistence/schemas';
import { runWriteTransaction } from '$lib/persistence/transactions';
import { AppError, persistenceWriteError } from './errors';
import { aggregateStartMonthPayments } from './plan-workspace';
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

export interface PaymentRemoval {
  payment: Payment;
  /**
   * False when a statement or corrected balance was entered after the payment, so that later
   * balance was kept instead of adding the payment back.
   */
  balanceRestored: boolean;
  balanceAfterMinor: number | null;
}

function compareSnapshots(left: BalanceSnapshot, right: BalanceSnapshot): number {
  const byCreated = left.createdAt.localeCompare(right.createdAt);
  return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id);
}

function isPaymentEstimateFor(snapshot: BalanceSnapshot, payment: Payment): boolean {
  return (
    snapshot.source === 'payment-estimate' &&
    snapshot.createdAt === payment.createdAt &&
    snapshot.recordedOn === payment.paidOn &&
    snapshot.balanceMinor === payment.estimatedBalanceAfterMinor
  );
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

  /** Totals per debt for payments dated in a `YYYY-MM` month. */
  async paidInMonth(month: string): Promise<StartMonthPayment[]> {
    const validMonth = validateInput(yearMonthSchema, month);
    return aggregateStartMonthPayments(await this.repositories.payments.inMonth(validMonth));
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

  /**
   * Deletes a payment and adds the amount it took off the debt back to the balance. A statement
   * or corrected balance entered after the payment already reflects reality, so it is kept.
   */
  async remove(paymentId: string): Promise<PaymentRemoval> {
    const validId = validateInput(identifierSchema, paymentId);

    try {
      return await runWriteTransaction(
        this.database,
        [this.database.debts, this.database.payments, this.database.balanceSnapshots],
        async () => {
          const payment = await this.repositories.payments.get(validId);
          if (!payment) {
            throw new AppError('VALIDATION_FAILED', 'This payment no longer exists.');
          }

          const snapshots = await this.repositories.balanceSnapshots.forDebt(payment.debtId);
          const estimate = snapshots.find((snapshot) => isPaymentEstimateFor(snapshot, payment));
          const remaining = snapshots
            .filter((snapshot) => snapshot !== estimate)
            .sort(compareSnapshots);

          await this.repositories.payments.delete(payment.id);
          if (estimate) await this.repositories.balanceSnapshots.delete(estimate.id);

          const debt = await this.repositories.debts.get(payment.debtId);
          if (!debt) return { payment, balanceRestored: false, balanceAfterMinor: null };

          const enteredLater = remaining.some(
            (snapshot) =>
              (snapshot.source === 'statement' || snapshot.source === 'manual-correction') &&
              snapshot.createdAt > payment.createdAt
          );
          if (enteredLater) {
            return { payment, balanceRestored: false, balanceAfterMinor: debt.currentBalanceMinor };
          }

          const latest = remaining.at(-1);
          const restoredBalanceMinor = checkedAdd(
            debt.currentBalanceMinor,
            checkedSubtract(payment.balanceBeforeMinor, payment.estimatedBalanceAfterMinor)
          );
          await this.repositories.debts.put(
            parseDebt({
              ...debt,
              currentBalanceMinor: restoredBalanceMinor,
              balanceAsOf: latest?.recordedOn ?? debt.balanceAsOf,
              balanceSource: latest?.source === 'payment-estimate' ? 'estimated' : 'user',
              updatedAt: this.dependencies.now()
            })
          );
          return { payment, balanceRestored: true, balanceAfterMinor: restoredBalanceMinor };
        },
        this.dependencies.now
      );
    } catch (error) {
      throw persistenceWriteError(error);
    }
  }
}
