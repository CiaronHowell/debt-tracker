import { describe, expect, it } from 'vitest';
import {
  addMonths,
  compareYearMonths,
  interestBearingDaysInMonth,
  isYearMonth,
  monthsBetween,
  parseCalendarDate,
  parseYearMonth
} from './dates';

describe('year-month primitives', () => {
  it('parses valid year-month values', () => {
    expect(parseYearMonth('2026-08')).toEqual({ year: 2026, month: 8 });
    expect(isYearMonth('2026-12')).toBe(true);
  });

  it('rejects malformed and impossible months', () => {
    expect(isYearMonth('2026-00')).toBe(false);
    expect(isYearMonth('2026-13')).toBe(false);
    expect(isYearMonth('26-08')).toBe(false);
    expect(() => parseYearMonth('2026-8')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE' })
    );
  });

  it('adds calendar months across year boundaries without duration arithmetic', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', 25)).toBe('2028-02');
  });

  it('compares and measures year-month values', () => {
    expect(compareYearMonths('2026-02', '2026-01')).toBeGreaterThan(0);
    expect(monthsBetween('2026-01', '2027-03')).toBe(14);
  });

  it('counts only days after an exact promotion expiry date', () => {
    expect(parseCalendarDate('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(() => parseCalendarDate('2027-02-29')).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATE' })
    );
    expect(interestBearingDaysInMonth('2027-09', '2027-10-15')).toEqual({
      interestBearingDays: 0,
      daysInMonth: 30
    });
    expect(interestBearingDaysInMonth('2027-10', '2027-10-15')).toEqual({
      interestBearingDays: 16,
      daysInMonth: 31
    });
    expect(interestBearingDaysInMonth('2027-11', '2027-10-15')).toEqual({
      interestBearingDays: 30,
      daysInMonth: 30
    });
  });
});
