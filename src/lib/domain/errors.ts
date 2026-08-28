export type DomainErrorCode =
  'INVALID_MONEY' | 'INVALID_APR' | 'INVALID_DATE' | 'ARITHMETIC_OVERFLOW' | 'NEGATIVE_RESULT';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
  }
}
