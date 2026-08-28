import type { Currency, MoneyMinor, ScenarioDebtInput } from '$lib/domain';

export type DebtType = 'credit-card' | 'loan' | 'overdraft' | 'other';
export type BalanceSource = 'user' | 'estimated';
export type SnapshotSource = 'setup' | 'statement' | 'manual-correction' | 'payment-estimate';

export interface Debt {
  id: string;
  name: string;
  type: DebtType;
  startingBalanceMinor: MoneyMinor;
  currentBalanceMinor: MoneyMinor;
  balanceAsOf: string;
  balanceSource: BalanceSource;
  aprBasisPoints: number | null;
  minimumPaymentMinor: MoneyMinor;
  dueDay: number | null;
  notes: string;
  colorKey: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface PlanSettings {
  id: 'primary';
  currency: Currency;
  startMonth: string;
  monthlyBudgetMinor: MoneyMinor;
  activeScenarioId: string | null;
  setupCompletedAt: string | null;
  updatedAt: string;
}

export interface Scenario {
  id: string;
  name: string;
  monthlyBudgetMinor: MoneyMinor;
  startMonth: string;
  algorithm: 'snowball';
  debtSnapshot: ScenarioDebtInput[];
  sourceScenarioId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  debtId: string;
  amountMinor: MoneyMinor;
  paidOn: string;
  note: string;
  balanceBeforeMinor: MoneyMinor;
  estimatedBalanceAfterMinor: MoneyMinor;
  createdAt: string;
}

export interface BalanceSnapshot {
  id: string;
  debtId: string;
  balanceMinor: MoneyMinor;
  recordedOn: string;
  source: SnapshotSource;
  createdAt: string;
}

export interface AppMeta {
  key: string;
  value: unknown;
  updatedAt: string;
}

export interface BackupPayload {
  debts: Debt[];
  planSettings: PlanSettings[];
  scenarios: Scenario[];
  payments: Payment[];
  balanceSnapshots: BalanceSnapshot[];
  appMeta: AppMeta[];
}

export interface PlainBackupEnvelope {
  format: 'debt-tracker-backup';
  version: 1;
  exportedAt: string;
  payload: BackupPayload;
}

export interface EncryptedBackupEnvelope {
  format: 'debt-tracker-backup-encrypted';
  version: 1;
  exportedAt: string;
  encryption: {
    algorithm: 'AES-256-GCM';
    keyDerivation: 'PBKDF2-HMAC-SHA-256';
    iterations: 600_000;
    salt: string;
    iv: string;
  };
  ciphertext: string;
}

export type BackupEnvelope = PlainBackupEnvelope | EncryptedBackupEnvelope;
