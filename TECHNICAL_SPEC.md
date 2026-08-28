# Debt Tracker — Implementation-Ready Technical Specification

Status: Approved for implementation
Version: 1.0
Date: 2026-08-28

## 1. Product definition

Debt Tracker is a local-first web application that helps one person build, follow, and revise a debt snowball plan. Its primary recurring job is to answer:

1. What should I pay now?
2. Am I still on track?
3. What happens next?

The application stores financial data on the user's device, performs all calculations in the browser, and makes no runtime calls to a backend or analytics service.

### 1.1 Approved visual direction

Use the action-first hybrid visual specification:

- **Home:** action-first dashboard led by the recommended payment.
- **Plan:** milestone timeline, with detailed amortization progressively disclosed.
- **Scenarios:** split planner workspace with inputs on the left and live results on the right.
- **Debts:** compact management list with a side panel on desktop and full-screen sheet on mobile.

### 1.2 MVP goals

- Create a plan in under five minutes.
- Calculate a deterministic debt snowball schedule.
- Make the next recommended payment obvious without navigation.
- Record payments and reconcile balances.
- Compare alternative monthly budgets without accidentally changing the active plan.
- Export, encrypt, import, and validate a complete local backup.
- Work at mobile, tablet, and desktop sizes.

### 1.3 Non-goals

The MVP does not include:

- User accounts or cloud synchronization.
- Bank/Open Banking integrations.
- Automatic transaction imports.
- Multiple household members.
- Cross-currency calculations or exchange rates.
- Variable APR periods, promotional-rate expiry, lender fees, or daily compounding.
- Refinancing or regulated financial recommendations.
- Native mobile applications.

## 2. Technical architecture

### 2.1 Stack

- **Application:** SvelteKit with Svelte and strict TypeScript.
- **Build:** Vite.
- **Deployment:** static SvelteKit output; no server runtime.
- **Persistence:** IndexedDB through Dexie.
- **Runtime validation:** Zod at form, database boundary, and import boundary.
- **Unit/component tests:** Vitest and Testing Library.
- **End-to-end tests:** Playwright.
- **Accessibility checks:** axe integrated into Playwright smoke tests.
- **Formatting/linting:** Prettier and ESLint.

Resolve current compatible package versions during scaffolding and commit the exact versions and lockfile. No third-party scripts, fonts, telemetry, or CDN assets are permitted at runtime.

### 2.2 Rendering model

The application is client-only because IndexedDB and Web Crypto are browser APIs and no page requires server rendering. Configure the root layout for static client rendering. Every route must remain directly loadable from a static host using the platform's SPA fallback.

### 2.3 Layering

```text
UI routes and components
        ↓
Application services / use cases
        ↓
Domain model + pure calculation engine
        ↓
Repository interfaces
        ↓
IndexedDB repositories
```

Rules:

- The calculation engine is pure TypeScript and imports no Svelte, browser, database, or date-formatting code.
- Components do not call Dexie directly.
- Writes pass through application services and runtime validation.
- Derived schedules are recalculated, not treated as authoritative financial records.
- Domain modules must not use floating-point currency arithmetic.

### 2.4 Suggested source layout

```text
src/
  lib/
    components/
      debts/
      layout/
      payments/
      plan/
      shared/
    domain/
      calculator.ts
      calculator.types.ts
      money.ts
      ordering.ts
      validation.ts
    application/
      debt-service.ts
      payment-service.ts
      plan-service.ts
      scenario-service.ts
      backup-service.ts
    persistence/
      db.ts
      migrations.ts
      repositories/
    state/
      active-plan.svelte.ts
      app-status.svelte.ts
    utils/
      dates.ts
      format.ts
  routes/
    +layout.svelte
    +layout.ts
    +page.svelte
    setup/+page.svelte
    debts/+page.svelte
    plan/+page.svelte
    settings/+page.svelte
  service-worker.ts
tests/
  fixtures/
  unit/
  integration/
  e2e/
```

## 3. Domain representation

### 3.1 Money

Store monetary values as integer minor units:

```ts
type MoneyMinor = number;
```

Invariants:

- Values are finite, safe integers.
- Values are non-negative unless a type explicitly permits signed deltas.
- Maximum accepted amount is 10,000,000 major currency units.
- The MVP supports currencies with two minor digits only: GBP, EUR, and USD.
- Formatting occurs only at the presentation boundary through `Intl.NumberFormat`.

The domain layer exposes checked helpers for addition, subtraction, comparison, capping, and multiplication/division with rounding. A helper throws a typed domain error if an operation would exceed `Number.MAX_SAFE_INTEGER`.

### 3.2 APR

Store APR as integer basis points:

```ts
type AprBasisPoints = number; // 19.99% = 1999
```

Accepted range: 0–100,000 basis points (0%–1,000%).

Monthly interest is estimated using nominal APR divided by 12:

```text
interestMinor = roundHalfUp(balanceMinor × aprBasisPoints / 120000)
```

Interest is applied before payments each simulated month. This monthly model must be explained as an estimate because lenders may compound daily and apply fees.

### 3.3 Dates

- Persist instants as UTC ISO 8601 strings.
- Persist calendar dates as `YYYY-MM-DD` strings.
- Persist simulation months as `YYYY-MM` strings.
- The plan start month defaults to the user's current local month.
- Month arithmetic must use explicit year/month helpers, never millisecond durations.

### 3.4 Identifiers

Use `crypto.randomUUID()` for persisted entity identifiers. Stable calculator fixture IDs may be human-readable strings in tests.

## 4. Persistence model

Database name: `debt-tracker`
Initial schema version: `1`

### 4.1 Debt

```ts
interface Debt {
  id: string;
  name: string;
  type: 'credit-card' | 'loan' | 'overdraft' | 'other';
  startingBalanceMinor: MoneyMinor;
  currentBalanceMinor: MoneyMinor;
  balanceAsOf: string; // YYYY-MM-DD
  balanceSource: 'user' | 'estimated';
  aprBasisPoints: AprBasisPoints | null;
  minimumPaymentMinor: MoneyMinor;
  dueDay: number | null; // 1–31, informational in MVP
  notes: string;
  colorKey: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}
```

An unknown APR is stored as `null`. Calculations temporarily use 0%, but all interest totals and payoff estimates are marked incomplete.

### 4.2 Plan settings

```ts
interface PlanSettings {
  id: 'primary';
  currency: 'GBP' | 'EUR' | 'USD';
  startMonth: string; // YYYY-MM
  monthlyBudgetMinor: MoneyMinor;
  activeScenarioId: string | null;
  setupCompletedAt: string | null;
  updatedAt: string;
}
```

### 4.3 Scenario

```ts
interface ScenarioDebtInput {
  debtId: string;
  name: string;
  balanceMinor: MoneyMinor;
  aprBasisPoints: AprBasisPoints | null;
  minimumPaymentMinor: MoneyMinor;
  createdAt: string;
}

interface Scenario {
  id: string;
  name: string;
  monthlyBudgetMinor: MoneyMinor;
  startMonth: string;
  algorithm: 'snowball';
  debtSnapshot: ScenarioDebtInput[];
  sourceScenarioId: string | null;
  createdAt: string;
  updatedAt: string;
}
```

A scenario captures its debt inputs so its displayed result does not silently change. If canonical debt data changes, compare a deterministic fingerprint and mark the scenario as stale. The user may refresh a stale scenario using current balances, which creates a new snapshot and updates `updatedAt`.

The active scenario is the current plan. Draft planner changes exist only in UI state until the user selects **Save as scenario** or **Make active plan**.

### 4.4 Payment

```ts
interface Payment {
  id: string;
  debtId: string;
  amountMinor: MoneyMinor;
  paidOn: string; // YYYY-MM-DD
  note: string;
  balanceBeforeMinor: MoneyMinor;
  estimatedBalanceAfterMinor: MoneyMinor;
  createdAt: string;
}
```

Recording a payment subtracts it from the last known balance, capped at zero, and marks the resulting debt balance as `estimated`. The payment and debt update occur in one database transaction.

### 4.5 Balance snapshot

```ts
interface BalanceSnapshot {
  id: string;
  debtId: string;
  balanceMinor: MoneyMinor;
  recordedOn: string; // YYYY-MM-DD
  source: 'setup' | 'statement' | 'manual-correction' | 'payment-estimate';
  createdAt: string;
}
```

Entering a statement balance is a reconciliation: it creates a snapshot, updates the canonical debt balance, sets `balanceSource` to `user`, and regenerates the active plan from current debt data after confirmation.

### 4.6 Application metadata

```ts
interface AppMeta {
  key: string;
  value: unknown;
  updatedAt: string;
}
```

Defined keys in v1:

- `schema-version`
- `last-export-at`
- `last-successful-write-at`
- `dismissed-notices`

### 4.7 IndexedDB tables and indexes

```text
debts:            &id, archivedAt, updatedAt
planSettings:     &id
scenarios:        &id, createdAt, updatedAt
payments:         &id, debtId, paidOn, createdAt
balanceSnapshots: &id, debtId, recordedOn, createdAt
appMeta:          &key
```

Every multi-entity command uses a Dexie transaction. Database migrations must be additive, versioned, and covered by an integration test using a database created at the previous version.

## 5. Snowball calculation contract

### 5.1 Input

```ts
interface CalculatePlanInput {
  currency: 'GBP' | 'EUR' | 'USD';
  startMonth: string;
  monthlyBudgetMinor: MoneyMinor;
  debts: ScenarioDebtInput[];
  maximumMonths?: number; // default 1200
}
```

### 5.2 Payoff order

At calculation start, freeze debt order using:

1. Lowest starting balance.
2. Highest APR when balances are equal; unknown APR sorts after known APR.
3. Earliest `createdAt`.
4. Lexicographical `debtId` as the final deterministic tie-breaker.

Do not reorder debts during a projection. Recalculating from newly reconciled balances may produce a new order, which must be explained to the user before replacing the active plan.

### 5.3 Monthly algorithm

For each month:

1. Start with the prior month's closing balances.
2. Apply one month of rounded interest to each active debt. Unknown APR uses zero and sets `hasIncompleteInterest = true`.
3. Calculate each active debt's required payment as `min(configured minimum, balance after interest)`.
4. If the monthly budget is less than the sum of required payments, return an `INSUFFICIENT_BUDGET` failure containing the shortfall.
5. Apply required payments to every active debt.
6. Set `remainingBudget = monthly budget - required payments actually applied`.
7. Apply remaining budget to the earliest active debt in frozen payoff order.
8. If that debt reaches zero, cascade unused money to the next active debt in the same month.
9. Record per-debt opening balance, interest, payment, principal reduction, and closing balance.
10. Stop when all balances are zero or the maximum month count is reached.

The monthly budget remains constant. Therefore, configured minimums released by cleared debts automatically become part of subsequent target payments.

### 5.4 Output

```ts
interface PlanProjection {
  status: 'success';
  payoffOrder: string[];
  startMonth: string;
  debtFreeMonth: string;
  durationMonths: number;
  totalStartingBalanceMinor: MoneyMinor;
  totalInterestMinor: MoneyMinor;
  totalPaidMinor: MoneyMinor;
  hasIncompleteInterest: boolean;
  warnings: ProjectionWarning[];
  milestones: DebtMilestone[];
  months: MonthlyProjection[];
}

type CalculatePlanResult =
  | PlanProjection
  | {
      status: 'failure';
      code: 'NO_DEBTS' | 'INSUFFICIENT_BUDGET' | 'NON_CONVERGING' | 'INVALID_INPUT';
      message: string;
      details: Record<string, unknown>;
    };
```

### 5.5 Warnings

Warnings do not block a successful projection:

- `UNKNOWN_APR`
- `NEGATIVE_AMORTIZATION_AT_MINIMUM`
- `ESTIMATED_BALANCE`
- `PAYOFF_ORDER_CHANGED`
- `LONG_REPAYMENT_PERIOD` for projections longer than 360 months

A debt is negative-amortizing at minimum when its first projected month's interest is greater than or equal to its configured minimum. The plan may still converge because the target receives extra payment.

### 5.6 Minimum-only comparison

Calculate each debt independently using its configured minimum payment and the same interest model. Do not roll cleared minimums into another debt for this baseline.

If any debt does not converge within 1,200 months, return the comparison as unavailable with the reason. Otherwise expose:

- Baseline debt-free month.
- Baseline total interest.
- Months saved.
- Interest saved.

The UI labels this comparison as an estimate.

## 6. Application routes and behavior

### 6.1 `/setup`

Four resumable steps:

1. Privacy and local-storage explanation.
2. Add debts.
3. Set monthly budget.
4. Review and activate the first plan.

Persist after each completed step. Redirect incomplete users from application routes to setup, except Settings so they can import a backup.

Completion criteria:

- At least one active debt.
- Valid currency and start month.
- Monthly budget covers required minimum payments.
- A generated scenario is saved and made active.

### 6.2 `/` — Home

Render in this order:

1. Recommended-payment card.
2. Other minimum payments due this simulated month.
3. Total debt, debt-free date, and paid-so-far metrics.
4. Next payoff milestone.
5. Recent payment history.

The primary CTA is **Record payment**. It opens a form pre-filled with target debt, recommended amount, and today's date.

After recording:

- Show the estimated resulting balance.
- Regenerate a draft from canonical current balances.
- Compare old and new projections.
- Explain changes to payoff date, order, interest, and next target.
- Require confirmation before replacing the active scenario snapshot.

### 6.3 `/debts`

Show active debts in a compact list. Sorting the management list does not alter calculator order.

Debt creation/edit validation:

- Name: trimmed, 1–80 characters.
- Balance: greater than zero for a new active debt.
- APR: optional, 0%–1,000%, at most two decimal places.
- Minimum payment: greater than zero.
- Due day: optional integer 1–31.
- Notes: at most 2,000 characters.

Archiving removes a debt from future projections but preserves payment and snapshot history. A debt with a zero reconciled balance is shown as paid and may be archived. Permanent deletion is not available from normal MVP UI.

### 6.4 `/plan`

Default view: payoff milestone timeline.

Each milestone displays:

- Debt name.
- Projected payoff month.
- Payment in its final month.
- Snowball amount available to the next debt.

Expandable details show monthly rows. The complete schedule is virtualized or paginated after 240 rows.

Planner controls:

- Total monthly budget input.
- Synchronized extra-payment input.
- Quick increments of 25, 50, and 100 currency units.
- Current-plan comparison.
- **Save as scenario** and **Make active plan** actions.

Budget changes update a debounced draft projection within 150 ms. The input itself updates immediately. Invalid drafts preserve the last successful result while displaying the blocking error.

### 6.5 `/settings`

Sections:

- Currency and plan start month.
- Local save status.
- Backup export/import.
- Privacy explanation.
- Reset application data.

Changing currency changes formatting only; it performs no conversion and requires explicit confirmation.

Reset requires the user to type `DELETE`. It clears the application database and reloads into setup. The reset action must not clear unrelated site storage.

## 7. UI system

### 7.1 Responsive layout

- **Mobile (<768 px):** bottom navigation, one-column content, full-screen editing sheets, sticky primary payment action.
- **Tablet (768–1023 px):** adaptive two-column summaries.
- **Desktop (>=1024 px):** side navigation, constrained content width, two-pane scenario planner.

Tables may scroll inside their own container but must not force page-level horizontal scrolling.

### 7.2 Visual semantics

- Neutral surfaces and one primary accent.
- Success color only for real progress or successful persistence.
- Warning color for incomplete inputs and risky assumptions.
- Danger color only for errors and destructive actions.
- System font stack; no external font request.
- Tabular numerals for balances, dates, and metrics.
- Use a consistent icon library; no emoji in product UI.
- Respect `prefers-reduced-motion`.

### 7.3 Accessibility

Target WCAG 2.2 AA.

- Full setup, planning, payment, import, and export flows work by keyboard.
- Every field has a persistent label and associated error text.
- Focus moves into opened sheets/dialogs and returns to the trigger on close.
- Recalculation results use a polite live region; errors use an assertive region only when blocking.
- Charts are optional enhancements and have equivalent text/table content.
- Color is never the sole status indicator.
- Touch targets are at least 44×44 CSS pixels.

### 7.4 Approved copy

- Primary action: **Record payment**
- Planner action: **Save as scenario**
- Activation action: **Make active plan**
- Empty state: **Add your first debt to build a payoff plan**
- Privacy status: **Saved on this device**
- Disclaimer: **This plan is an estimate. Lenders may calculate interest and fees differently.**

Generated explanations use structured templates, not free-form AI text. Examples:

- **Your debt-free date moved two months earlier because you paid £100 more than planned.**
- **Your target changed to Car loan because it now has the lowest balance.**
- **Interest totals are incomplete because Barclaycard has no APR.**

## 8. Local persistence and offline behavior

### 8.1 Save behavior

- Persist on explicit form submission, not every keystroke.
- Draft planner state remains in memory until saved or activated.
- Update `last-successful-write-at` in the same transaction as each successful command.
- Show **Saving…**, **Saved on this device**, or a recoverable error state.
- Retry transient IndexedDB failures once; never claim success before transaction completion.

### 8.2 Service worker

Cache only versioned application shell assets. Do not cache imported/exported user data. When a new application build is available, prompt the user to reload after current writes complete.

The calculator and existing data must remain usable offline after the first successful load.

### 8.3 Storage failure

If IndexedDB is unavailable:

- Allow an in-memory calculator session.
- Show a persistent warning that changes will disappear when the tab closes.
- Disable claims that data is saved.
- Keep export available so the user can preserve the in-memory plan.

## 9. Backup and restore

### 9.1 Plain backup

File extension: `.debt-plan.json`

```ts
interface PlainBackupEnvelope {
  format: 'debt-tracker-backup';
  version: 1;
  exportedAt: string;
  payload: BackupPayload;
}
```

Display an explicit warning that the file contains sensitive financial data.

### 9.2 Encrypted backup

File extension: `.debt-plan.enc.json`

Use Web Crypto:

- AES-256-GCM encryption.
- PBKDF2-HMAC-SHA-256 key derivation.
- 600,000 iterations.
- Random 16-byte salt.
- Random 12-byte IV.
- UTF-8 JSON plaintext.
- Base64-encoded binary fields.

The passphrase is never persisted or logged. Confirm it during export. Explain that a forgotten passphrase cannot be recovered.

### 9.3 Import workflow

1. Read the selected file into memory.
2. Detect plain or encrypted envelope.
3. Request passphrase when required.
4. Parse and validate every field with strict schemas.
5. Run explicit version migrations in memory.
6. Present counts and metadata for confirmation.
7. Create an in-database rollback snapshot of current data.
8. Replace application data in one transaction.
9. Re-open and validate the resulting active plan.
10. Remove the rollback snapshot only after successful verification.

A failed import must leave existing data unchanged. MVP supports replace-only import, not merging.

## 10. Security and privacy

- No backend, account, analytics, advertising, or telemetry.
- No third-party runtime scripts, fonts, images, or API calls.
- Configure a restrictive Content Security Policy compatible with the static application.
- Escape user content through framework rendering; do not render notes as HTML.
- Never place financial values in URLs, document titles, console logs, or error-reporting payloads.
- Do not persist encryption passphrases.
- Redact values from developer-facing error messages where practical.
- Include a privacy page explaining IndexedDB storage, backup responsibility, and browser-data deletion.
- The product provides estimates, not financial advice.

## 11. Error model

Use typed errors at service boundaries:

```ts
type AppErrorCode =
  | 'VALIDATION_FAILED'
  | 'INSUFFICIENT_BUDGET'
  | 'NON_CONVERGING_PLAN'
  | 'PERSISTENCE_UNAVAILABLE'
  | 'PERSISTENCE_WRITE_FAILED'
  | 'IMPORT_INVALID'
  | 'IMPORT_UNSUPPORTED_VERSION'
  | 'IMPORT_DECRYPTION_FAILED'
  | 'EXPORT_FAILED';
```

User messages state what happened and the next action. Internal causes may be retained in memory for debugging but are not persisted with financial values.

## 12. Testing requirements

### 12.1 Calculation unit tests

At minimum:

1. One 0% debt.
2. One interest-bearing debt with exact half-up rounding.
3. Several debts ordered by balance.
4. Equal balances resolved by APR.
5. Equal balance/APR resolved deterministically.
6. Minimum payments applied to non-target debts.
7. Target paid off with surplus cascading in the same month.
8. Balance below configured minimum.
9. Budget exactly equal to required minimums.
10. Budget below required minimums with exact shortfall.
11. Unknown APR and incomplete-result warning.
12. Negative amortization warning with a converging total plan.
13. Non-converging plan at 1,200 months.
14. Final payment capped at remaining balance.
15. Frozen order throughout one projection.
16. Recalculation producing a changed order.
17. Currency arithmetic overflow rejected.
18. Minimum-only comparison success and unavailable cases.

Golden fixtures must assert complete monthly rows for at least one multi-debt example. Property tests should assert conservation:

```text
opening balance + interest - payment = closing balance
sum(per-debt payments) <= monthly budget
all successful closing balances >= 0
final successful balances = 0
```

### 12.2 Persistence integration tests

- New database initialization.
- Transaction rollback on a failed multi-entity command.
- Payment and debt update atomicity.
- Scenario stale-fingerprint behavior.
- Previous-schema migration.
- Import validation and rollback.
- Plain and encrypted backup round trips.

### 12.3 Component tests

- Debt form validation.
- Budget shortfall state.
- Planner draft does not mutate active plan.
- Payment form defaults.
- Recalculation explanation templates.
- Keyboard behavior for dialogs and sheets.

### 12.4 End-to-end tests

1. Complete setup and activate a plan.
2. Read the next payment from Home.
3. Record a payment and accept the revised active plan.
4. Add a debt and review its impact.
5. Create and activate an alternative scenario.
6. Export, reset, and restore a plain backup.
7. Export and restore an encrypted backup.
8. Complete the primary flow at a mobile viewport.
9. Reload offline and access existing data.
10. Run automated accessibility checks on every main route.

## 13. Performance budgets

- Calculate 100 debts over 1,200 months in under 100 ms on a representative mid-range desktop in a production build.
- Keep ordinary planner recalculation off the network and below one animation frame where possible; show a calculating state above 100 ms.
- Initial compressed JavaScript target: under 250 KB, excluding optional test tooling.
- Avoid rendering more than 240 amortization rows simultaneously.
- IndexedDB writes for ordinary commands should complete in under 250 ms under normal conditions.

Performance thresholds are verified in CI where stable and profiled locally before release.

## 14. Implementation sequence

### Milestone 1 — Foundation

- Scaffold SvelteKit static application.
- Configure strict TypeScript, linting, formatting, Vitest, and Playwright.
- Establish design tokens, application shell, and responsive navigation.
- Add CSP and prevent runtime third-party requests.

Exit: static app builds and all quality commands run in CI.

### Milestone 2 — Domain engine

- Implement money/APR/date primitives.
- Implement snowball and minimum-only calculators.
- Add exhaustive fixtures, property tests, and typed failures.

Exit: calculator contract and required unit tests pass independently of UI.

### Milestone 3 — Persistence and backup

- Implement IndexedDB v1 schema and repositories.
- Add transactional services and scenario fingerprints.
- Add plain/encrypted export and transactional import.

Exit: persistence and backup integration tests pass.

### Milestone 4 — Setup and debt management

- Build resumable setup.
- Build debt list and edit surfaces.
- Create and activate the first plan.

Exit: a new user can create a valid plan in the E2E test.

### Milestone 5 — Action-first Home

- Build recommendation card, progress metrics, and milestones.
- Add payment recording, reconciliation, and change explanations.

Exit: monthly check-in flow passes E2E and accessibility tests.

### Milestone 6 — Plan and scenarios

- Build milestone timeline and expandable amortization.
- Build split scenario planner and active-plan confirmation.
- Add stale scenario handling.

Exit: scenario creation, comparison, and activation pass E2E.

### Milestone 7 — Offline and release hardening

- Add service worker and update prompt.
- Complete storage-failure behavior.
- Verify responsive layouts and new-user usability.
- Run security, accessibility, performance, and recovery checks.

Exit: all Definition of Done items pass.

## 15. Definition of Done

The MVP is ready when:

- All functional requirements in this specification are implemented.
- Calculator unit, property, integration, component, and E2E tests pass.
- Typecheck, lint, formatting check, and production build pass.
- The rendered application matches the approved action-first hybrid specification.
- Mobile, tablet, and desktop layouts are visually verified.
- A new-user usability review confirms discoverability and plain language.
- WCAG 2.2 AA automated checks pass and primary flows are manually keyboard-tested.
- Plain and encrypted backup recovery are verified from a clean browser profile.
- The app remains usable offline after initial load.
- No runtime request is made to a third party.
- Financial-estimate and local-backup limitations are visible at relevant decision points.

## 16. Deferred extension points

The architecture should permit, but the MVP must not prematurely implement:

- Avalanche and custom payoff ordering.
- Recurring and one-off extra payments.
- Variable APR schedules and promotional expiry dates.
- Daily interest models.
- Optional cloud synchronization through repository adapters.
- Shared household plans.
- Additional currency minor-unit rules.
- CSV export of amortization schedules.
- Installable PWA metadata and platform-specific enhancements.

## 17. Milestone 2 contract clarifications

The implemented domain contract extends the abbreviated interfaces above with three optional or derived fields required by the warning and comparison requirements:

- `ScenarioDebtInput.balanceSource?: 'user' | 'estimated'` enables `ESTIMATED_BALANCE` warnings.
- `CalculatePlanInput.previousPayoffOrder?: string[]` enables deterministic `PAYOFF_ORDER_CHANGED` warnings during reconciliation.
- `PlanProjection.minimumOnlyComparison` contains the available comparison metrics or a typed `NON_CONVERGING_DEBT` reason.

These additions do not change persisted v1 data requirements: omitted `balanceSource` is treated as user-entered, and `previousPayoffOrder` is calculation context rather than persisted scenario data.
