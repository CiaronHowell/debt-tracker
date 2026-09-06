import { afterEach, describe, expect, it } from 'vitest';
import { DebtTrackerDatabase } from '$lib/persistence/db';
import type { PlainBackupEnvelope } from '$lib/persistence/models';
import { BackupService } from './backup-service';
import { DebtService } from './debt-service';
import { PayLaterService } from './pay-later-service';
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

async function seedActivePlan(database: DebtTrackerDatabase, suffix: string): Promise<void> {
  const debtService = new DebtService(database, {
    now: () => FIXED_NOW,
    createId: idSequence(`debt-${suffix}`, `snapshot-${suffix}`)
  });
  await debtService.create({
    name: `Card ${suffix}`,
    type: 'credit-card',
    startingBalanceMinor: 12_000,
    balanceAsOf: '2026-08-28',
    aprBasisPoints: 1_999,
    promotionalAprEndsOn: null,
    minimumPaymentMinor: 1_000,
    dueDay: 12,
    notes: '',
    colorKey: null
  });
  await new PlanService(database, { now: () => FIXED_NOW }).saveSettings({
    currency: 'GBP',
    startMonth: '2026-08',
    monthlyBudgetMinor: 4_000
  });
  const scenarios = new ScenarioService(database, {
    now: () => FIXED_NOW,
    createId: idSequence(`scenario-${suffix}`)
  });
  const scenario = await scenarios.create({
    name: `Plan ${suffix}`,
    monthlyBudgetMinor: 4_000,
    startMonth: '2026-08'
  });
  await scenarios.activate(scenario.id);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('BackupService', () => {
  it('round-trips a strict plain backup into a clean database', async () => {
    const source = createDatabase('plain-source');
    await seedActivePlan(source, 'source');
    await new PayLaterService(source, {
      now: () => FIXED_NOW,
      createId: idSequence('pay-later-source')
    }).create({
      name: 'Recovery purchase',
      startingBalanceMinor: 24_000,
      purchaseDate: '2026-08-28',
      deadlineDate: '2027-02-28',
      missedDeadlineAprBasisPoints: 3_499,
      notes: ''
    });
    const sourceBackups = new BackupService(source, { now: () => FIXED_NOW });
    const envelope = await sourceBackups.exportPlain();

    expect(envelope).toMatchObject({
      format: 'debt-tracker-backup',
      version: 1,
      exportedAt: FIXED_NOW
    });
    expect(await sourceBackups.preview(sourceBackups.serialize(envelope))).toMatchObject({
      encrypted: false,
      counts: { debts: 1, scenarios: 1, payLaterPlans: 1, payLaterPayments: 0 }
    });

    const target = createDatabase('plain-target');
    const result = await new BackupService(target, { now: () => FIXED_NOW }).importBackup(
      sourceBackups.serialize(envelope)
    );
    expect(result.activeScenarioId).toBe('scenario-source');
    await expect(target.debts.get('debt-source')).resolves.toMatchObject({
      name: 'Card source'
    });
    await expect(target.payLaterPlans.get('pay-later-source')).resolves.toMatchObject({
      name: 'Recovery purchase',
      currentBalanceMinor: 24_000
    });
    await expect(new PlanService(target).getActiveProjection()).resolves.toMatchObject({
      status: 'success'
    });
  });

  it('restores older version-1 backups that omit promotional APR fields', async () => {
    const source = createDatabase('legacy-source');
    await seedActivePlan(source, 'legacy');
    const sourceBackups = new BackupService(source, { now: () => FIXED_NOW });
    const legacy = structuredClone(await sourceBackups.exportPlain()) as unknown as {
      payload: {
        debts: Array<Record<string, unknown>>;
        scenarios: Array<{ debtSnapshot: Array<Record<string, unknown>> }>;
        payLaterPlans?: unknown;
        payLaterPayments?: unknown;
      };
    };
    delete legacy.payload.debts[0]!.promotionalAprEndsOn;
    delete legacy.payload.scenarios[0]!.debtSnapshot[0]!.promotionalAprEndsOn;
    delete legacy.payload.payLaterPlans;
    delete legacy.payload.payLaterPayments;

    const target = createDatabase('legacy-target');
    const targetBackups = new BackupService(target, { now: () => FIXED_NOW });
    await targetBackups.importBackup(JSON.stringify(legacy));

    await expect(target.debts.get('debt-legacy')).resolves.toMatchObject({
      promotionalAprEndsOn: null
    });
    await expect(target.scenarios.get('scenario-legacy')).resolves.toMatchObject({
      debtSnapshot: [expect.objectContaining({ promotionalAprEndsOn: null })]
    });
  });

  it('round-trips AES-GCM data and never mutates existing data for a wrong passphrase', async () => {
    const source = createDatabase('encrypted-source');
    await seedActivePlan(source, 'source');
    const sourceBackups = new BackupService(source, { now: () => FIXED_NOW });
    const encrypted = await sourceBackups.exportEncrypted('correct horse battery staple');

    expect(encrypted.encryption).toMatchObject({
      algorithm: 'AES-256-GCM',
      keyDerivation: 'PBKDF2-HMAC-SHA-256',
      iterations: 600_000
    });
    expect(encrypted).not.toHaveProperty('payload');
    expect(JSON.stringify(encrypted)).not.toContain('Card source');

    const target = createDatabase('encrypted-target');
    await seedActivePlan(target, 'existing');
    const targetBackups = new BackupService(target, { now: () => FIXED_NOW });
    const before = await target.debts.toArray();
    await expect(
      targetBackups.importBackup(sourceBackups.serialize(encrypted), 'wrong passphrase')
    ).rejects.toMatchObject({ code: 'IMPORT_DECRYPTION_FAILED' });
    await expect(target.debts.toArray()).resolves.toEqual(before);

    const tampered = structuredClone(encrypted);
    tampered.ciphertext = `${tampered.ciphertext.startsWith('A') ? 'B' : 'A'}${tampered.ciphertext.slice(1)}`;
    await expect(
      targetBackups.importBackup(tampered, 'correct horse battery staple')
    ).rejects.toMatchObject({ code: 'IMPORT_DECRYPTION_FAILED' });
    await expect(target.debts.toArray()).resolves.toEqual(before);

    const result = await targetBackups.importBackup(
      sourceBackups.serialize(encrypted),
      'correct horse battery staple'
    );
    expect(result).toMatchObject({ encrypted: true, activeScenarioId: 'scenario-source' });
    await expect(target.debts.get('debt-existing')).resolves.toBeUndefined();
    await expect(target.debts.get('debt-source')).resolves.toBeDefined();
  });

  it('rejects malformed data without replacement and restores an interrupted import marker', async () => {
    const source = createDatabase('invalid-source');
    await seedActivePlan(source, 'source');
    const sourceBackups = new BackupService(source, { now: () => FIXED_NOW });
    const envelope = await sourceBackups.exportPlain();

    const target = createDatabase('invalid-target');
    await seedActivePlan(target, 'existing');
    const targetBackups = new BackupService(target, { now: () => FIXED_NOW });
    const before = await target.debts.toArray();

    await expect(targetBackups.importBackup({ ...envelope, version: 2 })).rejects.toMatchObject({
      code: 'IMPORT_UNSUPPORTED_VERSION'
    });
    await expect(target.debts.toArray()).resolves.toEqual(before);

    const orphaned = structuredClone(envelope);
    orphaned.payload.scenarios[0]!.debtSnapshot[0]!.debtId = 'missing-debt';
    await expect(targetBackups.importBackup(orphaned)).rejects.toMatchObject({
      code: 'IMPORT_INVALID'
    });
    await expect(target.debts.toArray()).resolves.toEqual(before);

    const malformed = structuredClone(envelope) as PlainBackupEnvelope & {
      payload: { debts: Array<Record<string, unknown>> };
    };
    malformed.payload.debts[0]!.unexpected = 'strict schemas reject this';

    await expect(targetBackups.importBackup(malformed)).rejects.toMatchObject({
      code: 'IMPORT_INVALID'
    });
    await expect(target.debts.toArray()).resolves.toEqual(before);

    const rollback = (await targetBackups.exportPlain()).payload;
    await target.debts.clear();
    await target.appMeta.put({
      key: 'internal-import-rollback',
      value: rollback,
      updatedAt: FIXED_NOW
    });
    await expect(targetBackups.recoverInterruptedImport()).resolves.toBe(true);
    await expect(target.debts.get('debt-existing')).resolves.toBeDefined();
    await expect(target.appMeta.get('internal-import-rollback')).resolves.toBeUndefined();
  });
});
