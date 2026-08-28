import { describe, expect, it } from 'vitest';
import { formatMoneyInput, parseAprInput, parseMoneyInput } from './money';

describe('money input utilities', () => {
  it('parses decimal major units into exact integer minor units', () => {
    expect(parseMoneyInput('123.45')).toBe(12_345);
    expect(parseMoneyInput('7')).toBe(700);
    expect(parseMoneyInput('0.5')).toBe(50);
    expect(formatMoneyInput(12_345)).toBe('123.45');
  });

  it('rejects ambiguous, negative, over-precision, and oversized money', () => {
    expect(parseMoneyInput('01.00')).toBeNull();
    expect(parseMoneyInput('-1.00')).toBeNull();
    expect(parseMoneyInput('1.001')).toBeNull();
    expect(parseMoneyInput('10000000.01')).toBeNull();
  });

  it('parses APR percentages as basis points with the domain cap', () => {
    expect(parseAprInput('19.99')).toBe(1_999);
    expect(parseAprInput('1000.00')).toBe(100_000);
    expect(parseAprInput('1000.01')).toBeNull();
  });
});
