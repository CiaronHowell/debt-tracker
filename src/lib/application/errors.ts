export type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_BUDGET'
  | 'NON_CONVERGING_PLAN'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'IMPORT_INVALID'
  | 'IMPORT_UNSUPPORTED_VERSION'
  | 'IMPORT_DECRYPTION_FAILED'
  | 'EXPORT_FAILED'
  | 'SYNC_UNAUTHORIZED'
  | 'SYNC_LOCKED'
  | 'SYNC_CONFLICT'
  | 'SYNC_PASSPHRASE_INVALID'
  | 'SYNC_NETWORK';

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  override readonly cause?: unknown;

  constructor(
    code: AppErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    cause?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function persistenceWriteError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  return new AppError(
    'PERSISTENCE_WRITE_FAILED',
    'The change could not be saved on this device. Try again.',
    {},
    cause
  );
}
