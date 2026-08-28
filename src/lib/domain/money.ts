import type { AprBasisPoints, MoneyMinor, YearMonth } from './calculator.types';
import { interestBearingDaysInMonth } from './dates';
import { DomainError } from './errors';

export const MIN_MONEY_MINOR = 0;
export const MAX_INPUT_MONEY_MINOR = 1_000_000_000;
export const MIN_APR_BASIS_POINTS = 0;
export const MAX_APR_BASIS_POINTS = 100_000;
const MONTHLY_INTEREST_DENOMINATOR = 120_000;

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new DomainError('INVALID_MONEY', `${field} must be a finite safe integer.`, {
      field,
      value
    });
  }
}

export function assertMoneyMinor(
  value: number,
  field = 'money',
  maximum = MAX_INPUT_MONEY_MINOR
): asserts value is MoneyMinor {
  assertSafeInteger(value, field);

  if (value < MIN_MONEY_MINOR || value > maximum) {
    throw new DomainError(
      'INVALID_MONEY',
      `${field} must be between ${MIN_MONEY_MINOR} and ${maximum} minor units.`,
      { field, value, minimum: MIN_MONEY_MINOR, maximum }
    );
  }
}

export function assertAprBasisPoints(
  value: number,
  field = 'aprBasisPoints'
): asserts value is AprBasisPoints {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
    throw new DomainError('INVALID_APR', `${field} must be a finite safe integer.`, {
      field,
      value
    });
  }

  if (value < MIN_APR_BASIS_POINTS || value > MAX_APR_BASIS_POINTS) {
    throw new DomainError(
      'INVALID_APR',
      `${field} must be between ${MIN_APR_BASIS_POINTS} and ${MAX_APR_BASIS_POINTS}.`,
      { field, value, minimum: MIN_APR_BASIS_POINTS, maximum: MAX_APR_BASIS_POINTS }
    );
  }
}

export function checkedAdd(...values: MoneyMinor[]): MoneyMinor {
  let total = 0;

  for (const value of values) {
    assertSafeInteger(value, 'addend');
    const next = total + value;
    if (!Number.isSafeInteger(next)) {
      throw new DomainError('ARITHMETIC_OVERFLOW', 'Money addition exceeded safe integer range.', {
        total,
        value
      });
    }
    total = next;
  }

  return total;
}

export function checkedSubtract(left: MoneyMinor, right: MoneyMinor): MoneyMinor {
  assertSafeInteger(left, 'minuend');
  assertSafeInteger(right, 'subtrahend');
  const result = left - right;

  if (!Number.isSafeInteger(result)) {
    throw new DomainError('ARITHMETIC_OVERFLOW', 'Money subtraction exceeded safe integer range.', {
      left,
      right
    });
  }
  if (result < 0) {
    throw new DomainError('NEGATIVE_RESULT', 'Money subtraction produced a negative result.', {
      left,
      right
    });
  }

  return result;
}

export function checkedMultiply(left: number, right: number): number {
  assertSafeInteger(left, 'multiplicand');
  assertSafeInteger(right, 'multiplier');
  const result = left * right;

  if (!Number.isSafeInteger(result)) {
    throw new DomainError(
      'ARITHMETIC_OVERFLOW',
      'Integer multiplication exceeded safe integer range.',
      { left, right }
    );
  }

  return result;
}

export function roundHalfUpRatio(numerator: number, denominator: number): MoneyMinor {
  assertSafeInteger(numerator, 'numerator');
  assertSafeInteger(denominator, 'denominator');

  if (numerator < 0 || denominator <= 0) {
    throw new DomainError(
      'INVALID_MONEY',
      'Rounding requires a non-negative numerator and positive denominator.',
      {
        numerator,
        denominator
      }
    );
  }

  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator % denominator;
  const rounded = remainder * 2 >= denominator ? quotient + 1 : quotient;

  if (!Number.isSafeInteger(rounded)) {
    throw new DomainError('ARITHMETIC_OVERFLOW', 'Rounded result exceeded safe integer range.', {
      numerator,
      denominator
    });
  }

  return rounded;
}

export function calculateMonthlyInterest(
  balanceMinor: MoneyMinor,
  aprBasisPoints: AprBasisPoints
): MoneyMinor {
  assertMoneyMinor(balanceMinor, 'balanceMinor', Number.MAX_SAFE_INTEGER);
  assertAprBasisPoints(aprBasisPoints);
  const numerator = checkedMultiply(balanceMinor, aprBasisPoints);
  return roundHalfUpRatio(numerator, MONTHLY_INTEREST_DENOMINATOR);
}

export function sumMoney(values: Iterable<MoneyMinor>): MoneyMinor {
  let total = 0;
  for (const value of values) total = checkedAdd(total, value);
  return total;
}

export function capPayment(requested: MoneyMinor, balanceMinor: MoneyMinor): MoneyMinor {
  assertSafeInteger(requested, 'requestedPayment');
  assertSafeInteger(balanceMinor, 'balanceMinor');
  if (requested < 0 || balanceMinor < 0) {
    throw new DomainError('INVALID_MONEY', 'Payment and balance must be non-negative.', {
      requested,
      balanceMinor
    });
  }
  return Math.min(requested, balanceMinor);
}

export function calculateMonthlyInterestForPeriod(
  balanceMinor: MoneyMinor,
  aprBasisPoints: AprBasisPoints,
  month: YearMonth,
  promotionalAprEndsOn?: string | null
): MoneyMinor {
  if (!promotionalAprEndsOn) return calculateMonthlyInterest(balanceMinor, aprBasisPoints);

  const { interestBearingDays, daysInMonth } = interestBearingDaysInMonth(
    month,
    promotionalAprEndsOn
  );
  if (interestBearingDays === 0) return 0;
  if (interestBearingDays === daysInMonth) {
    return calculateMonthlyInterest(balanceMinor, aprBasisPoints);
  }

  assertMoneyMinor(balanceMinor, 'balanceMinor', Number.MAX_SAFE_INTEGER);
  assertAprBasisPoints(aprBasisPoints);
  const balanceAndApr = checkedMultiply(balanceMinor, aprBasisPoints);
  const numerator = checkedMultiply(balanceAndApr, interestBearingDays);
  return roundHalfUpRatio(numerator, MONTHLY_INTEREST_DENOMINATOR * daysInMonth);
}
