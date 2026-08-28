import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import {
  assertAprBasisPoints,
  assertMoneyMinor,
  calculateMonthlyInterest,
  capPayment,
  checkedAdd,
  checkedMultiply,
  checkedSubtract,
  roundHalfUpRatio
} from './money';

describe('money primitives', () => {
  it('accepts valid input money and APR boundaries', () => {
    expect(() => assertMoneyMinor(0)).not.toThrow();
    expect(() => assertMoneyMinor(1_000_000_000)).not.toThrow();
    expect(() => assertAprBasisPoints(0)).not.toThrow();
    expect(() => assertAprBasisPoints(100_000)).not.toThrow();
  });

  it('rejects fractions, negative values, and values above input limits', () => {
    expect(() => assertMoneyMinor(1.5)).toThrow(DomainError);
    expect(() => assertMoneyMinor(-1)).toThrow(DomainError);
    expect(() => assertMoneyMinor(1_000_000_001)).toThrow(DomainError);
    expect(() => assertAprBasisPoints(100_001)).toThrow(DomainError);
  });

  it('rounds exact halves away from zero for non-negative money', () => {
    expect(roundHalfUpRatio(1, 2)).toBe(1);
    expect(roundHalfUpRatio(4, 3)).toBe(1);
    expect(roundHalfUpRatio(5, 3)).toBe(2);
  });

  it('calculates monthly nominal APR interest in minor units', () => {
    expect(calculateMonthlyInterest(10_000, 1_200)).toBe(100);
    expect(calculateMonthlyInterest(50, 1_200)).toBe(1);
    expect(calculateMonthlyInterest(10_000, 0)).toBe(0);
  });

  it('checks addition, subtraction, payment capping, and overflow', () => {
    expect(checkedAdd(10, 20, 30)).toBe(60);
    expect(checkedSubtract(30, 20)).toBe(10);
    expect(capPayment(100, 40)).toBe(40);
    expect(() => checkedSubtract(20, 30)).toThrowError(
      expect.objectContaining({ code: 'NEGATIVE_RESULT' })
    );
    expect(() => checkedMultiply(Number.MAX_SAFE_INTEGER, 2)).toThrowError(
      expect.objectContaining({ code: 'ARITHMETIC_OVERFLOW' })
    );
  });
});
