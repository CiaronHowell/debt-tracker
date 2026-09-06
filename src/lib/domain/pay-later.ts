import type { MoneyMinor } from './calculator.types';
import { parseCalendarDate } from './dates';
import { DomainError } from './errors';

export type PayLaterScheduleStatus = 'paid' | 'overdue' | 'catch-up' | 'on-track';

export interface PayLaterScheduleInput {
  startingBalanceMinor: MoneyMinor;
  currentBalanceMinor: MoneyMinor;
  purchaseDate: string;
  deadlineDate: string;
  asOfDate: string;
}

export interface PayLaterSchedule {
  status: PayLaterScheduleStatus;
  paymentMonthsRemaining: number;
  totalPaymentMonths: number;
  baselineMonthlyTargetMinor: MoneyMinor;
  monthlyTargetMinor: MoneyMinor;
  progressPercent: number;
}

function monthIndex(value: string, field: string): number {
  const date = parseCalendarDate(value, field);
  return date.year * 12 + date.month;
}

function monthlyTarget(balanceMinor: MoneyMinor, months: number): MoneyMinor {
  return months <= 0 ? balanceMinor : Math.ceil(balanceMinor / months);
}

export function calculatePayLaterSchedule(input: PayLaterScheduleInput): PayLaterSchedule {
  const purchaseMonth = monthIndex(input.purchaseDate, 'purchaseDate');
  const deadlineMonth = monthIndex(input.deadlineDate, 'deadlineDate');
  const asOfMonth = monthIndex(input.asOfDate, 'asOfDate');

  if (input.deadlineDate < input.purchaseDate) {
    throw new DomainError(
      'INVALID_DATE',
      'The payment deadline cannot be before the purchase date.'
    );
  }
  if (
    !Number.isSafeInteger(input.startingBalanceMinor) ||
    !Number.isSafeInteger(input.currentBalanceMinor) ||
    input.startingBalanceMinor <= 0 ||
    input.currentBalanceMinor < 0
  ) {
    throw new DomainError(
      'INVALID_MONEY',
      'Pay-later balances must be safe non-negative integers.'
    );
  }

  const totalPaymentMonths = deadlineMonth - purchaseMonth + 1;
  const effectiveStartMonth = Math.max(asOfMonth, purchaseMonth);
  const overdue = input.asOfDate > input.deadlineDate;
  const paymentMonthsRemaining = overdue ? 0 : Math.max(1, deadlineMonth - effectiveStartMonth + 1);
  const baselineMonthlyTargetMinor = monthlyTarget(input.startingBalanceMinor, totalPaymentMonths);
  const requiredMonthlyTargetMinor = monthlyTarget(
    input.currentBalanceMinor,
    paymentMonthsRemaining
  );
  const progressPercent = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        ((input.startingBalanceMinor - input.currentBalanceMinor) / input.startingBalanceMinor) *
          100
      )
    )
  );

  let status: PayLaterScheduleStatus;
  if (input.currentBalanceMinor === 0) status = 'paid';
  else if (overdue) status = 'overdue';
  else if (requiredMonthlyTargetMinor > baselineMonthlyTargetMinor) status = 'catch-up';
  else status = 'on-track';

  return {
    status,
    paymentMonthsRemaining,
    totalPaymentMonths,
    baselineMonthlyTargetMinor,
    monthlyTargetMinor: input.currentBalanceMinor === 0 ? 0 : requiredMonthlyTargetMinor,
    progressPercent
  };
}
