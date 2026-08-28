import type { YearMonth } from './calculator.types';
import { DomainError } from './errors';

const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

interface ParsedYearMonth {
  year: number;
  month: number;
}

export function parseYearMonth(value: string, field = 'yearMonth'): ParsedYearMonth {
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) {
    throw new DomainError('INVALID_DATE', `${field} must use YYYY-MM format.`, { field, value });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || year > 9999 || month < 1 || month > 12) {
    throw new DomainError('INVALID_DATE', `${field} contains an invalid calendar month.`, {
      field,
      value
    });
  }

  return { year, month };
}

export function isYearMonth(value: string): value is YearMonth {
  try {
    parseYearMonth(value);
    return true;
  } catch {
    return false;
  }
}

export function addMonths(value: YearMonth, delta: number): YearMonth {
  const { year, month } = parseYearMonth(value);
  if (!Number.isSafeInteger(delta)) {
    throw new DomainError('INVALID_DATE', 'Month delta must be a safe integer.', { delta });
  }

  const totalMonths = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = ((totalMonths % 12) + 12) % 12;

  if (nextYear < 1 || nextYear > 9999) {
    throw new DomainError('INVALID_DATE', 'Month arithmetic exceeded the supported year range.', {
      value,
      delta
    });
  }

  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth + 1).padStart(2, '0')}`;
}

export function compareYearMonths(left: YearMonth, right: YearMonth): number {
  const leftParsed = parseYearMonth(left, 'leftYearMonth');
  const rightParsed = parseYearMonth(right, 'rightYearMonth');
  const leftIndex = leftParsed.year * 12 + leftParsed.month;
  const rightIndex = rightParsed.year * 12 + rightParsed.month;
  return leftIndex - rightIndex;
}

export function monthsBetween(start: YearMonth, end: YearMonth): number {
  const startParsed = parseYearMonth(start, 'startMonth');
  const endParsed = parseYearMonth(end, 'endMonth');
  return (endParsed.year - startParsed.year) * 12 + (endParsed.month - startParsed.month);
}
