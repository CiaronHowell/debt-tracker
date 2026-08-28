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

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface ParsedCalendarDate {
  year: number;
  month: number;
  day: number;
}

export function daysInCalendarMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function parseCalendarDate(value: string, field = 'calendarDate'): ParsedCalendarDate {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) {
    throw new DomainError('INVALID_DATE', `${field} must use YYYY-MM-DD format.`, { field, value });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    year > 9999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInCalendarMonth(year, month)
  ) {
    throw new DomainError('INVALID_DATE', `${field} contains an invalid calendar date.`, {
      field,
      value
    });
  }

  return { year, month, day };
}

export function interestBearingDaysInMonth(
  month: YearMonth,
  promotionalAprEndsOn: string
): {
  interestBearingDays: number;
  daysInMonth: number;
} {
  const parsedMonth = parseYearMonth(month, 'projectionMonth');
  const expiry = parseCalendarDate(promotionalAprEndsOn, 'promotionalAprEndsOn');
  const daysInMonth = daysInCalendarMonth(parsedMonth.year, parsedMonth.month);
  const monthIndex = parsedMonth.year * 12 + parsedMonth.month;
  const expiryMonthIndex = expiry.year * 12 + expiry.month;

  if (expiryMonthIndex < monthIndex) return { interestBearingDays: daysInMonth, daysInMonth };
  if (expiryMonthIndex > monthIndex) return { interestBearingDays: 0, daysInMonth };
  return { interestBearingDays: daysInMonth - expiry.day, daysInMonth };
}
