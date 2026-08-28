import { afterEach, describe, expect, it } from 'vitest';
import { DebtTrackerDatabase } from '$lib/persistence/db';
import { DebtService } from './debt-service';
import { PaymentService } from './payment-service';
import { PlanService } from './plan-service';
import { ScenarioService } from './scenario-service';

const FIXED_NOW = '2026-08-28T08:00:00.000Z';
const databases: DebtTrackerDatabase[] = [];

function idSequence(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('Test ID sequence exhausted.');
    return id;
  };
}

function createDatabase(label: string): DebtTrackerDatabase {
  const database = new DebtTrackerDatabase(`debt-tracker-${label}-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

const debtInput = {
  name: 'Card',
  type: 'credit-card' as const,
  startingBalanceMinor: 10_000,
  balanceAsOf: '2026-08-28',
  aprBasisPoints: 0,
  minimumPaymentMinor: 1_000,
  dueDay: 12,
  notes: '',
  colorKey: null
};

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('transactional application services', () => {
  it('updates payment, debt, and snapshot atomically and rolls back a duplicate payment', async () => {
    const database = createDatabase('payments');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1')
    });
    await debtService.create(debtInput);
    await database.payments.add({
      id: 'duplicate-payment',
      debtId: 'debt-1',
      amountMinor: 100,
      paidOn: '2026-08-28',
      note: '',
      balanceBeforeMinor: 10_000,
      estimatedBalanceAfterMinor: 9_900,
      createdAt: FIXED_NOW
    });

    const failingService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('duplicate-payment', 'unused-snapshot')
    });
    const failure = failingService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-08-28',
      note: ''
    });
    await expect(failure).rejects.toMatchObject({
      code: 'PERSISTENCE_WRITE_FAILED'
    });
    await expect(database.debts.get('debt-1')).resolves.toMatchObject({
      currentBalanceMinor: 10_000,
      balanceSource: 'user'
    });
    await expect(database.balanceSnapshots.count()).resolves.toBe(1);

    const paymentService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('payment-1', 'payment-snapshot-1')
    });
    const payment = await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-08-28',
      note: 'Monthly payment'
    });

    expect(payment.estimatedBalanceAfterMinor).toBe(7_500);
    await expect(database.debts.get('debt-1')).resolves.toMatchObject({
      currentBalanceMinor: 7_500,
      balanceSource: 'estimated'
    });
    await expect(database.balanceSnapshots.count()).resolves.toBe(2);
    await expect(database.appMeta.get('last-successful-write-at')).resolves.toMatchObject({
      value: FIXED_NOW
    });
  });

  it('updates debt details and a corrected balance in one command', async () => {
    const database = createDatabase('debt-edit');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1', 'correction-snapshot-1')
    });
    await debtService.create(debtInput);

    const updated = await debtService.update('debt-1', {
      name: 'Updated card',
      type: 'credit-card',
      balanceMinor: 8_000,
      balanceAsOf: '2026-08-28',
      aprBasisPoints: 0,
      minimumPaymentMinor: 1_000,
      dueDay: 15,
      notes: 'Updated locally',
      colorKey: null
    });

    expect(updated).toMatchObject({
      name: 'Updated card',
      currentBalanceMinor: 8_000,
      dueDay: 15,
      balanceSource: 'user'
    });
    await expect(database.balanceSnapshots.count()).resolves.toBe(2);
    await expect(database.balanceSnapshots.get('correction-snapshot-1')).resolves.toMatchObject({
      source: 'manual-correction',
      balanceMinor: 8_000
    });
  });

  it('detects canonical debt changes and clears staleness after refresh', async () => {
    const database = createDatabase('scenario-staleness');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1', 'reconcile-snapshot-1')
    });
    await debtService.create(debtInput);
    const planService = new PlanService(database, { now: () => FIXED_NOW });
    await planService.saveSettings({
      currency: 'GBP',
      startMonth: '2026-08',
      monthlyBudgetMinor: 5_000
    });
    const scenarioService = new ScenarioService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('scenario-1')
    });
    const scenario = await scenarioService.create({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });

    await expect(scenarioService.isStale(scenario.id)).resolves.toBe(false);
    await debtService.reconcileBalance({
      debtId: 'debt-1',
      balanceMinor: 8_000,
      recordedOn: '2026-08-28',
      source: 'statement'
    });
    await expect(scenarioService.isStale(scenario.id)).resolves.toBe(true);

    const refreshed = await scenarioService.refresh(scenario.id);
    expect(refreshed.debtSnapshot[0]?.balanceMinor).toBe(8_000);
    await expect(scenarioService.isStale(scenario.id)).resolves.toBe(false);
  });
});
