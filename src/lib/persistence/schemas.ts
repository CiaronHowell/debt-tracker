import { z } from 'zod';
import { MAX_APR_BASIS_POINTS, MAX_INPUT_MONEY_MINOR } from '$lib/domain';
import type {
  AppMeta,
  BackupPayload,
  BalanceSnapshot,
  Debt,
  EncryptedBackupEnvelope,
  Payment,
  PayLaterPayment,
  PayLaterPlan,
  PlainBackupEnvelope,
  PlanSettings,
  Scenario
} from './models';

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    year >= 1 &&
    year <= 9999 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isYearMonth(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12;
}

function isUtcInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !value.endsWith('Z')) return false;
  return !Number.isNaN(Date.parse(value));
}

export const identifierSchema = z.string().min(1).max(128);
export const moneyMinorSchema = z.number().int().min(0).max(MAX_INPUT_MONEY_MINOR);
export const positiveMoneyMinorSchema = moneyMinorSchema.min(1);
export const aprBasisPointsSchema = z.number().int().min(0).max(MAX_APR_BASIS_POINTS);
export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, 'Expected a valid YYYY-MM-DD date.');
export const yearMonthSchema = z.string().refine(isYearMonth, 'Expected a valid YYYY-MM month.');
export const utcInstantSchema = z.string().refine(isUtcInstant, 'Expected a UTC ISO 8601 instant.');

export const scenarioDebtInputSchema = z.strictObject({
  debtId: identifierSchema,
  name: z.string().trim().min(1).max(80),
  balanceMinor: moneyMinorSchema,
  aprBasisPoints: aprBasisPointsSchema.nullable(),
  promotionalAprEndsOn: calendarDateSchema.nullable().default(null),
  minimumPaymentMinor: positiveMoneyMinorSchema,
  createdAt: utcInstantSchema,
  balanceSource: z.enum(['user', 'estimated']).optional()
});

export const debtSchema = z.strictObject({
  id: identifierSchema,
  name: z.string().trim().min(1).max(80),
  type: z.enum(['credit-card', 'balance-transfer', 'loan', 'overdraft', 'other']),
  startingBalanceMinor: moneyMinorSchema,
  currentBalanceMinor: moneyMinorSchema,
  balanceAsOf: calendarDateSchema,
  balanceSource: z.enum(['user', 'estimated']),
  aprBasisPoints: aprBasisPointsSchema.nullable(),
  promotionalAprEndsOn: calendarDateSchema.nullable().default(null),
  minimumPaymentMinor: positiveMoneyMinorSchema,
  dueDay: z.number().int().min(1).max(31).nullable(),
  notes: z.string().max(2_000),
  colorKey: z.string().min(1).max(64).nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema,
  archivedAt: utcInstantSchema.nullable()
});

export const planSettingsSchema = z.strictObject({
  id: z.literal('primary'),
  currency: z.enum(['GBP', 'EUR', 'USD']),
  startMonth: yearMonthSchema,
  monthlyBudgetMinor: moneyMinorSchema,
  activeScenarioId: identifierSchema.nullable(),
  setupCompletedAt: utcInstantSchema.nullable(),
  updatedAt: utcInstantSchema
});

export const scenarioSchema = z.strictObject({
  id: identifierSchema,
  name: z.string().trim().min(1).max(80),
  monthlyBudgetMinor: moneyMinorSchema,
  startMonth: yearMonthSchema,
  algorithm: z.enum(['snowball', 'deadline-aware']).default('snowball'),
  debtSnapshot: z.array(scenarioDebtInputSchema),
  sourceScenarioId: identifierSchema.nullable(),
  createdAt: utcInstantSchema,
  updatedAt: utcInstantSchema
});

export const paymentSchema = z.strictObject({
  id: identifierSchema,
  debtId: identifierSchema,
  amountMinor: positiveMoneyMinorSchema,
  paidOn: calendarDateSchema,
  note: z.string().max(2_000),
  balanceBeforeMinor: moneyMinorSchema,
  estimatedBalanceAfterMinor: moneyMinorSchema,
  createdAt: utcInstantSchema
});

export const payLaterPlanSchema = z
  .strictObject({
    id: identifierSchema,
    name: z.string().trim().min(1).max(80),
    startingBalanceMinor: positiveMoneyMinorSchema,
    currentBalanceMinor: moneyMinorSchema,
    purchaseDate: calendarDateSchema,
    deadlineDate: calendarDateSchema,
    missedDeadlineAprBasisPoints: aprBasisPointsSchema.nullable(),
    notes: z.string().max(2_000),
    createdAt: utcInstantSchema,
    updatedAt: utcInstantSchema,
    archivedAt: utcInstantSchema.nullable()
  })
  .refine((plan) => plan.deadlineDate >= plan.purchaseDate, {
    message: 'The payment deadline cannot be before the purchase date.',
    path: ['deadlineDate']
  });

export const payLaterPaymentSchema = z.strictObject({
  id: identifierSchema,
  planId: identifierSchema,
  amountMinor: positiveMoneyMinorSchema,
  paidOn: calendarDateSchema,
  note: z.string().max(2_000),
  balanceBeforeMinor: moneyMinorSchema,
  balanceAfterMinor: moneyMinorSchema,
  createdAt: utcInstantSchema
});

export const balanceSnapshotSchema = z.strictObject({
  id: identifierSchema,
  debtId: identifierSchema,
  balanceMinor: moneyMinorSchema,
  recordedOn: calendarDateSchema,
  source: z.enum(['setup', 'statement', 'manual-correction', 'payment-estimate']),
  createdAt: utcInstantSchema
});

export const appMetaSchema = z.strictObject({
  key: z.string().min(1).max(128),
  value: z.unknown(),
  updatedAt: utcInstantSchema
});

export const backupPayloadSchema = z.strictObject({
  debts: z.array(debtSchema),
  planSettings: z.array(planSettingsSchema),
  scenarios: z.array(scenarioSchema),
  payments: z.array(paymentSchema),
  payLaterPlans: z.array(payLaterPlanSchema).default([]),
  payLaterPayments: z.array(payLaterPaymentSchema).default([]),
  balanceSnapshots: z.array(balanceSnapshotSchema),
  appMeta: z.array(appMetaSchema)
});

export const plainBackupEnvelopeSchema = z.strictObject({
  format: z.literal('debt-tracker-backup'),
  version: z.literal(1),
  exportedAt: utcInstantSchema,
  payload: backupPayloadSchema
});

export const encryptedBackupEnvelopeSchema = z.strictObject({
  format: z.literal('debt-tracker-backup-encrypted'),
  version: z.literal(1),
  exportedAt: utcInstantSchema,
  encryption: z.strictObject({
    algorithm: z.literal('AES-256-GCM'),
    keyDerivation: z.literal('PBKDF2-HMAC-SHA-256'),
    iterations: z.literal(600_000),
    salt: z.string().min(1),
    iv: z.string().min(1)
  }),
  ciphertext: z.string().min(1)
});

export function parseDebt(value: unknown): Debt {
  return debtSchema.parse(value) as Debt;
}

export function parsePlanSettings(value: unknown): PlanSettings {
  return planSettingsSchema.parse(value) as PlanSettings;
}

export function parseScenario(value: unknown): Scenario {
  return scenarioSchema.parse(value) as Scenario;
}

export function parsePayment(value: unknown): Payment {
  return paymentSchema.parse(value) as Payment;
}

export function parsePayLaterPlan(value: unknown): PayLaterPlan {
  return payLaterPlanSchema.parse(value) as PayLaterPlan;
}

export function parsePayLaterPayment(value: unknown): PayLaterPayment {
  return payLaterPaymentSchema.parse(value) as PayLaterPayment;
}

export function parseBalanceSnapshot(value: unknown): BalanceSnapshot {
  return balanceSnapshotSchema.parse(value) as BalanceSnapshot;
}

export function parseAppMeta(value: unknown): AppMeta {
  return appMetaSchema.parse(value) as AppMeta;
}

export function parseBackupPayload(value: unknown): BackupPayload {
  return backupPayloadSchema.parse(value) as BackupPayload;
}

export function parsePlainBackupEnvelope(value: unknown): PlainBackupEnvelope {
  return plainBackupEnvelopeSchema.parse(value) as PlainBackupEnvelope;
}

export function parseEncryptedBackupEnvelope(value: unknown): EncryptedBackupEnvelope {
  return encryptedBackupEnvelopeSchema.parse(value) as EncryptedBackupEnvelope;
}
