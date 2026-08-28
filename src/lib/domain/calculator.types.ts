export type Currency = 'GBP' | 'EUR' | 'USD';
export type MoneyMinor = number;
export type SignedMoneyMinor = number;
export type AprBasisPoints = number;
export type YearMonth = string;
export type PayoffAlgorithm = 'snowball' | 'deadline-aware';

export interface ScenarioDebtInput {
  debtId: string;
  name: string;
  balanceMinor: MoneyMinor;
  aprBasisPoints: AprBasisPoints | null;
  promotionalAprEndsOn?: string | null;
  minimumPaymentMinor: MoneyMinor;
  createdAt: string;
  balanceSource?: 'user' | 'estimated';
}

export interface CalculatePlanInput {
  currency: Currency;
  startMonth: YearMonth;
  monthlyBudgetMinor: MoneyMinor;
  debts: ScenarioDebtInput[];
  algorithm?: PayoffAlgorithm;
  maximumMonths?: number;
  previousPayoffOrder?: string[];
}

export type ProjectionWarningCode =
  | 'UNKNOWN_APR'
  | 'PROMOTION_EXPIRES_BEFORE_PAYOFF'
  | 'NEGATIVE_AMORTIZATION_AT_MINIMUM'
  | 'ESTIMATED_BALANCE'
  | 'PAYOFF_ORDER_CHANGED'
  | 'LONG_REPAYMENT_PERIOD';

export interface ProjectionWarning {
  code: ProjectionWarningCode;
  message: string;
  debtId?: string;
  details?: Readonly<Record<string, unknown>>;
}

export interface MonthlyDebtProjection {
  debtId: string;
  name: string;
  openingBalanceMinor: MoneyMinor;
  interestMinor: MoneyMinor;
  requiredPaymentMinor: MoneyMinor;
  paymentMinor: MoneyMinor;
  principalReductionMinor: SignedMoneyMinor;
  closingBalanceMinor: MoneyMinor;
}

export interface MonthlyProjection {
  month: YearMonth;
  monthNumber: number;
  targetDebtId: string | null;
  totalInterestMinor: MoneyMinor;
  totalPaymentMinor: MoneyMinor;
  debts: MonthlyDebtProjection[];
}

export interface DebtMilestone {
  debtId: string;
  name: string;
  payoffMonth: YearMonth;
  payoffMonthNumber: number;
  finalPaymentMinor: MoneyMinor;
  nextTargetDebtId: string | null;
  nextTargetPaymentMinor: MoneyMinor;
}

export interface PromotionImpact {
  debtId: string;
  name: string;
  promotionalAprEndsOn: string;
  postPromotionAprBasisPoints: AprBasisPoints | null;
  atRisk: boolean;
  balanceAtExpiryMinor: MoneyMinor;
  firstFullMonthInterestMinor: MoneyMinor | null;
  paymentMonthsRemaining: number;
  requiredMonthlyPaymentMinor: MoneyMinor;
  plannedMonthlyPaymentMinor: MoneyMinor;
  monthlyPaymentShortfallMinor: MoneyMinor;
}

export interface MinimumOnlyComparisonAvailable {
  status: 'available';
  debtFreeMonth: YearMonth;
  durationMonths: number;
  totalInterestMinor: MoneyMinor;
  monthsSaved: number;
  interestSavedMinor: MoneyMinor;
}

export interface MinimumOnlyComparisonUnavailable {
  status: 'unavailable';
  reason: 'NON_CONVERGING_DEBT';
  debtIds: string[];
}

export type MinimumOnlyComparison =
  MinimumOnlyComparisonAvailable | MinimumOnlyComparisonUnavailable;

export interface PlanProjection {
  status: 'success';
  algorithm: PayoffAlgorithm;
  payoffOrder: string[];
  startMonth: YearMonth;
  debtFreeMonth: YearMonth;
  durationMonths: number;
  totalStartingBalanceMinor: MoneyMinor;
  totalInterestMinor: MoneyMinor;
  totalPaidMinor: MoneyMinor;
  hasIncompleteInterest: boolean;
  warnings: ProjectionWarning[];
  promotionImpacts: PromotionImpact[];
  milestones: DebtMilestone[];
  months: MonthlyProjection[];
  minimumOnlyComparison: MinimumOnlyComparison;
}

export type CalculationFailureCode =
  'NO_DEBTS' | 'INSUFFICIENT_BUDGET' | 'NON_CONVERGING' | 'INVALID_INPUT';

export interface CalculationFailure {
  status: 'failure';
  code: CalculationFailureCode;
  message: string;
  details: Readonly<Record<string, unknown>>;
}

export type CalculatePlanResult = PlanProjection | CalculationFailure;
