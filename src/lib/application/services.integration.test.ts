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
  promotionalAprEndsOn: null,
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
      promotionalAprEndsOn: null,
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

  it('previews payment changes without replacing the active plan until confirmation', async () => {
    const database = createDatabase('payment-review');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1')
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
      createId: idSequence('scenario-1', 'scenario-2')
    });
    const original = await scenarioService.createAndActivate({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });

    const paymentService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('payment-1', 'payment-snapshot-1')
    });
    await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-08-28',
      note: ''
    });

    const pending = await planService.getActivePlanReview();
    expect(pending).toMatchObject({
      isStale: true,
      scenario: { id: original.id },
      currentProjection: { totalStartingBalanceMinor: 7_500 }
    });
    // £2,500 of August's £5,000 budget is already paid, so only £2,500 is left to plan.
    expect(pending?.currentProjection?.months[0]).toMatchObject({
      month: '2026-08',
      totalPaymentMinor: 2_500
    });
    await expect(database.planSettings.get('primary')).resolves.toMatchObject({
      activeScenarioId: original.id
    });
    await expect(paymentService.history()).resolves.toMatchObject({
      totalPaidMinor: 2_500,
      recent: [{ id: 'payment-1' }]
    });

    const refreshed = await scenarioService.refresh(original.id, '2026-08');
    expect(refreshed).toMatchObject({
      id: original.id,
      name: 'Primary plan',
      startMonth: '2026-08',
      startMonthPayments: [{ debtId: 'debt-1', amountMinor: 2_500 }]
    });
    await expect(database.scenarios.count()).resolves.toBe(1);
    await expect(database.planSettings.get('primary')).resolves.toMatchObject({
      activeScenarioId: original.id
    });
    const accepted = await planService.getActivePlanReview('2026-08');
    expect(accepted).toMatchObject({ isStale: false });
    expect(accepted?.activeProjection.months[0]?.totalPaymentMinor).toBe(2_500);
  });

  it('regenerates a stale plan from the current month rather than the saved start month', async () => {
    const database = createDatabase('payment-review-later-month');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1')
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
    await scenarioService.createAndActivate({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });

    await expect(planService.getActivePlanReview('2026-10')).resolves.toMatchObject({
      isStale: false,
      currentStartMonth: '2026-10',
      activeProjection: { startMonth: '2026-08' }
    });

    const paymentService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('payment-1', 'payment-snapshot-1')
    });
    await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-10-02',
      note: ''
    });

    const review = await planService.getActivePlanReview('2026-10');
    expect(review).toMatchObject({
      isStale: true,
      currentStartMonth: '2026-10',
      currentProjection: { startMonth: '2026-10', totalStartingBalanceMinor: 7_500 }
    });
    expect(review?.currentProjection?.months[0]).toMatchObject({
      month: '2026-10',
      totalPaymentMinor: 2_500
    });
  });

  it('moves a refreshed active plan to the current month and counts its payments', async () => {
    const database = createDatabase('refresh-current-month');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-1', 'setup-snapshot-1')
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
      createId: idSequence('scenario-1', 'scenario-2')
    });
    const active = await scenarioService.createAndActivate({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });
    const alternative = await scenarioService.create({
      name: 'Alternative plan',
      monthlyBudgetMinor: 7_500,
      startMonth: '2026-08'
    });
    const paymentService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('payment-1', 'payment-snapshot-1')
    });
    await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-10-02',
      note: ''
    });

    await expect(scenarioService.refresh(active.id, '2026-10')).resolves.toMatchObject({
      startMonth: '2026-10',
      startMonthPayments: [{ debtId: 'debt-1', amountMinor: 2_500 }]
    });
    await expect(planService.getSettings()).resolves.toMatchObject({ startMonth: '2026-10' });

    await expect(scenarioService.refresh(alternative.id, '2026-10')).resolves.toMatchObject({
      startMonth: '2026-10'
    });
    await expect(planService.getSettings()).resolves.toMatchObject({
      activeScenarioId: active.id,
      monthlyBudgetMinor: 5_000
    });
  });
});

describe('payment removal', () => {
  const EARLIER = '2026-08-28T07:00:00.000Z';
  const LATER = '2026-08-29T08:00:00.000Z';

  async function setUpRecordedPayment(label: string) {
    const database = createDatabase(label);
    await new DebtService(database, {
      now: () => EARLIER,
      createId: idSequence('debt-1', 'setup-snapshot-1')
    }).create(debtInput);
    const debtService = new DebtService(database, {
      now: () => LATER,
      createId: idSequence('statement-snapshot-1')
    });
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
    const scenario = await scenarioService.createAndActivate({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });
    const paymentService = new PaymentService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('payment-1', 'payment-snapshot-1', 'payment-2', 'payment-snapshot-2')
    });
    await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 2_500,
      paidOn: '2026-08-30',
      note: ''
    });
    return { database, debtService, planService, scenarioService, paymentService, scenario };
  }

  it('restores the balance and the original plan when the latest payment is removed', async () => {
    const { database, planService, paymentService } = await setUpRecordedPayment('remove-undo');
    await expect(planService.getActivePlanReview('2026-08')).resolves.toMatchObject({
      isStale: true
    });

    await expect(paymentService.remove('payment-1')).resolves.toMatchObject({
      payment: { id: 'payment-1' },
      balanceRestored: true,
      balanceAfterMinor: 10_000
    });

    await expect(database.debts.get('debt-1')).resolves.toMatchObject({
      currentBalanceMinor: 10_000,
      balanceAsOf: '2026-08-28',
      balanceSource: 'user'
    });
    await expect(database.payments.count()).resolves.toBe(0);
    await expect(database.balanceSnapshots.toArray()).resolves.toEqual([
      expect.objectContaining({ id: 'setup-snapshot-1' })
    ]);
    await expect(planService.getActivePlanReview('2026-08')).resolves.toMatchObject({
      isStale: false
    });
    await expect(paymentService.history()).resolves.toMatchObject({ totalPaidMinor: 0 });
  });

  it('adds back only the removed payment when later payments remain', async () => {
    const { database, paymentService } = await setUpRecordedPayment('remove-earlier');
    await paymentService.record({
      debtId: 'debt-1',
      amountMinor: 1_000,
      paidOn: '2026-08-31',
      note: ''
    });

    await expect(paymentService.remove('payment-1')).resolves.toMatchObject({
      balanceRestored: true,
      balanceAfterMinor: 9_000
    });
    await expect(database.debts.get('debt-1')).resolves.toMatchObject({
      currentBalanceMinor: 9_000,
      balanceAsOf: '2026-08-31',
      balanceSource: 'estimated'
    });
    await expect(paymentService.paidInMonth('2026-08')).resolves.toEqual([
      { debtId: 'debt-1', amountMinor: 1_000 }
    ]);
  });

  it('keeps a statement balance entered after the removed payment', async () => {
    const { database, debtService, planService, scenarioService, paymentService, scenario } =
      await setUpRecordedPayment('remove-after-statement');
    await debtService.reconcileBalance({
      debtId: 'debt-1',
      balanceMinor: 7_000,
      recordedOn: '2026-08-31',
      source: 'statement'
    });
    await scenarioService.refresh(scenario.id, '2026-08');
    await expect(planService.getActivePlanReview('2026-08')).resolves.toMatchObject({
      isStale: false
    });

    await expect(paymentService.remove('payment-1')).resolves.toMatchObject({
      balanceRestored: false,
      balanceAfterMinor: 7_000
    });
    await expect(database.debts.get('debt-1')).resolves.toMatchObject({
      currentBalanceMinor: 7_000,
      balanceSource: 'user'
    });

    // Balances are unchanged, but the plan no longer has the removed payment to count.
    const review = await planService.getActivePlanReview('2026-08');
    expect(review).toMatchObject({ isStale: true });
    expect(review?.currentProjection?.months[0]?.totalPaymentMinor).toBe(5_000);
  });

  it('rejects removing a payment that does not exist', async () => {
    const { paymentService } = await setUpRecordedPayment('remove-missing');

    await expect(paymentService.remove('missing-payment')).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'This payment no longer exists.'
    });
  });
});

describe('scenario workspace services', () => {
  it('lists, previews, renames, refreshes, and safely activates saved plans', async () => {
    const database = createDatabase('scenario-workspace');
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
      createId: idSequence('scenario-1', 'scenario-2')
    });
    const active = await scenarioService.createAndActivate({
      name: 'Primary plan',
      monthlyBudgetMinor: 5_000,
      startMonth: '2026-08'
    });
    const alternative = await scenarioService.create({
      name: 'Faster plan',
      monthlyBudgetMinor: 7_500,
      startMonth: '2026-08',
      sourceScenarioId: active.id
    });

    await expect(scenarioService.workspace()).resolves.toMatchObject([
      { scenario: { id: active.id, name: 'Primary plan' }, isStale: false },
      { scenario: { id: alternative.id, name: 'Faster plan' }, isStale: false }
    ]);
    await expect(
      scenarioService.preview({ monthlyBudgetMinor: 7_500, startMonth: '2026-08' })
    ).resolves.toMatchObject({ status: 'success', durationMonths: 2 });
    await expect(database.scenarios.count()).resolves.toBe(2);

    await expect(scenarioService.rename(alternative.id, 'Weekend plan')).resolves.toMatchObject({
      name: 'Weekend plan'
    });
    await debtService.reconcileBalance({
      debtId: 'debt-1',
      balanceMinor: 8_000,
      recordedOn: '2026-08-28',
      source: 'statement'
    });
    await expect(scenarioService.activate(alternative.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'Refresh this saved plan with current balances before making it active.'
    });

    await scenarioService.refresh(alternative.id);
    await expect(scenarioService.activate(alternative.id)).resolves.toMatchObject({
      id: alternative.id,
      name: 'Weekend plan'
    });
    await expect(planService.getSettings()).resolves.toMatchObject({
      activeScenarioId: alternative.id,
      monthlyBudgetMinor: 7_500
    });
  });

  it('persists promotion terms in snapshots and detects expiry edits as stale', async () => {
    const database = createDatabase('promotion-staleness');
    const debtService = new DebtService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('debt-promo', 'snapshot-promo')
    });
    const debt = await debtService.create({
      name: 'Balance transfer',
      type: 'balance-transfer',
      startingBalanceMinor: 20_000,
      balanceAsOf: '2026-08-28',
      aprBasisPoints: 2_490,
      promotionalAprEndsOn: '2027-10-15',
      minimumPaymentMinor: 1_000,
      dueDay: 15,
      notes: '',
      colorKey: null
    });
    await new PlanService(database, { now: () => FIXED_NOW }).saveSettings({
      currency: 'GBP',
      startMonth: '2026-08',
      monthlyBudgetMinor: 2_000
    });
    const scenarios = new ScenarioService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('scenario-promo')
    });
    const scenario = await scenarios.create({
      name: 'Promotion plan',
      monthlyBudgetMinor: 2_000,
      startMonth: '2026-08',
      algorithm: 'deadline-aware'
    });

    expect(scenario).toMatchObject({ algorithm: 'deadline-aware' });
    expect(scenario.debtSnapshot[0]).toMatchObject({
      promotionalAprEndsOn: '2027-10-15'
    });
    await debtService.update(debt.id, {
      name: debt.name,
      type: debt.type,
      balanceMinor: debt.currentBalanceMinor,
      balanceAsOf: debt.balanceAsOf,
      aprBasisPoints: debt.aprBasisPoints,
      promotionalAprEndsOn: '2027-11-15',
      minimumPaymentMinor: debt.minimumPaymentMinor,
      dueDay: debt.dueDay,
      notes: debt.notes,
      colorKey: debt.colorKey
    });
    await expect(scenarios.isStale(scenario.id)).resolves.toBe(true);
  });
});
