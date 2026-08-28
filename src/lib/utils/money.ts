import { MAX_APR_BASIS_POINTS, MAX_INPUT_MONEY_MINOR, type Currency } from '$lib/domain';

const DECIMAL_INPUT_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function parseTwoDecimalValue(value: string, maximum: number): number | null {
  const normalized = value.trim();
  const match = DECIMAL_INPUT_PATTERN.exec(normalized);
  if (!match) return null;

  const [majorPart = '0', fractionPart = ''] = normalized.split('.');
  const minor = BigInt(majorPart) * 100n + BigInt(fractionPart.padEnd(2, '0'));
  if (minor > BigInt(maximum)) return null;
  return Number(minor);
}

export function parseMoneyInput(value: string): number | null {
  return parseTwoDecimalValue(value, MAX_INPUT_MONEY_MINOR);
}

export function parseAprInput(value: string): number | null {
  return parseTwoDecimalValue(value, MAX_APR_BASIS_POINTS);
}

export function formatMoneyInput(minor: number): string {
  const major = Math.floor(minor / 100);
  const fraction = String(minor % 100).padStart(2, '0');
  return `${major}.${fraction}`;
}

export function formatMoney(minor: number, currency: Currency): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(minor / 100);
}

export function currencySymbol(currency: Currency): string {
  return (
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 0
    })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}
