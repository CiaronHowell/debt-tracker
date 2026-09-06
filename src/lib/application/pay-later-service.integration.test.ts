import { afterEach, describe, expect, it } from 'vitest';
import { DebtTrackerDatabase } from '$lib/persistence/db';
import { PayLaterService } from './pay-later-service';

const FIXED_NOW = '2026-09-02T10:00:00.000Z';
const databases: DebtTrackerDatabase[] = [];

function idSequence(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error('Test ID sequence exhausted.');
    return id;
  };
}

function createDatabase(label: string): DebtTrackerDatabase {
  const database = new DebtTrackerDatabase(`pay-later-${label}-${crypto.randomUUID()}`);
  databases.push(database);
  return database;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('PayLaterService', () => {
  it('creates and schedules a commitment without creating a debt or scenario', async () => {
    const database = createDatabase('create');
    const service = new PayLaterService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('plan-1')
    });

    await service.create({
      name: 'Argos furniture',
      startingBalanceMinor: 60_000,
      purchaseDate: '2026-09-02',
      deadlineDate: '2027-04-15',
      missedDeadlineAprBasisPoints: 3_499,
      notes: ''
    });

    await expect(service.summary('2026-09-02')).resolves.toMatchObject({
      totalBalanceMinor: 60_000,
      monthlyAllocationMinor: 7_500,
      overdueCount: 0,
      plans: [{ plan: { id: 'plan-1' }, schedule: { status: 'on-track' } }]
    });
    await expect(database.debts.count()).resolves.toBe(0);
    await expect(database.scenarios.count()).resolves.toBe(0);
  });

  it('records a payment atomically and recalculates the separate monthly allocation', async () => {
    const database = createDatabase('payment');
    const service = new PayLaterService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('plan-1', 'payment-1')
    });
    await service.create({
      name: 'Argos furniture',
      startingBalanceMinor: 60_000,
      purchaseDate: '2026-09-02',
      deadlineDate: '2027-04-15',
      missedDeadlineAprBasisPoints: null,
      notes: ''
    });

    await expect(
      service.recordPayment({
        planId: 'plan-1',
        amountMinor: 15_000,
        paidOn: '2026-09-02',
        note: 'First payment'
      })
    ).resolves.toMatchObject({ balanceBeforeMinor: 60_000, balanceAfterMinor: 45_000 });
    await expect(database.payLaterPlans.get('plan-1')).resolves.toMatchObject({
      currentBalanceMinor: 45_000
    });
    await expect(service.summary('2026-09-02')).resolves.toMatchObject({
      totalBalanceMinor: 45_000,
      monthlyAllocationMinor: 5_625
    });
  });

  it('rejects an invalid deadline and excludes archived commitments', async () => {
    const database = createDatabase('validation');
    const service = new PayLaterService(database, {
      now: () => FIXED_NOW,
      createId: idSequence('plan-1')
    });

    await expect(
      service.create({
        name: 'Invalid plan',
        startingBalanceMinor: 10_000,
        purchaseDate: '2026-09-02',
        deadlineDate: '2026-09-01',
        missedDeadlineAprBasisPoints: null,
        notes: ''
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    const plan = await service.create({
      name: 'Valid plan',
      startingBalanceMinor: 10_000,
      purchaseDate: '2026-09-02',
      deadlineDate: '2026-12-01',
      missedDeadlineAprBasisPoints: null,
      notes: ''
    });
    await service.archive(plan.id);
    await expect(service.workspace('2026-09-02')).resolves.toEqual([]);
  });
});
