<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount, tick } from 'svelte';
  import {
    ArrowRight,
    CalendarDays,
    CheckCircle2,
    CreditCard,
    History,
    LockKeyhole,
    RefreshCw,
    Target,
    TrendingDown,
    WalletCards
  } from '@lucide/svelte';
  import PaymentForm, {
    type PaymentFormSubmission
  } from '$lib/components/payments/PaymentForm.svelte';
  import BalanceReconciliationForm, {
    type BalanceReconciliationSubmission
  } from '$lib/components/payments/BalanceReconciliationForm.svelte';
  import {
    DebtService,
    PaymentService,
    PlanService,
    ScenarioService,
    type ActivePlanReview
  } from '$lib/application';
  import { getDatabase, getPersistenceMode, type Debt, type Payment } from '$lib/persistence';
  import type { Currency } from '$lib/domain';
  import { formatCalendarDate, formatYearMonth } from '$lib/utils/dates';
  import { formatMoney } from '$lib/utils/money';
  import { explainPlanChanges } from '$lib/utils/plan-explanations';

  const database = getDatabase();
  const memoryOnly = getPersistenceMode() === 'memory';
  const debtService = new DebtService(database);
  const paymentService = new PaymentService(database);
  const planService = new PlanService(database);
  const scenarioService = new ScenarioService(database);

  let review = $state<ActivePlanReview | null>(null);
  let debts = $state<Debt[]>([]);
  let recentPayments = $state<Payment[]>([]);
  let totalPaidMinor = $state(0);
  let currency = $state<Currency>('GBP');
  let loading = $state(true);
  let error = $state('');
  let statusMessage = $state('');
  let paymentOpen = $state(false);
  let reconciliationOpen = $state(false);
  let reviewVisible = $state(false);
  let updatingPlan = $state(false);
  let latestPayment = $state<Payment | null>(null);
  let recordButton = $state<HTMLButtonElement>();
  let reviewPanel = $state<HTMLElement>();

  let displayProjection = $derived(
    review?.isStale && review.currentProjection
      ? review.currentProjection
      : (review?.activeProjection ?? null)
  );
  let firstMonth = $derived(displayProjection?.months[0] ?? null);
  let target = $derived.by(() => {
    if (!firstMonth?.targetDebtId) return null;
    return firstMonth.debts.find((debt) => debt.debtId === firstMonth?.targetDebtId) ?? null;
  });
  let otherMinimums = $derived(
    firstMonth?.debts.filter(
      (debt) => debt.debtId !== firstMonth?.targetDebtId && debt.requiredPaymentMinor > 0
    ) ?? []
  );
  let totalDebtMinor = $derived(debts.reduce((total, debt) => total + debt.currentBalanceMinor, 0));
  let nextMilestone = $derived(displayProjection?.milestones[0] ?? null);
  let suggestedAmounts = $derived.by(() =>
    Object.fromEntries(firstMonth?.debts.map((debt) => [debt.debtId, debt.paymentMinor]) ?? [])
  );
  let explanations = $derived(
    review?.comparison ? explainPlanChanges(review.comparison, currency) : []
  );
  let reviewDebtId = $derived(latestPayment?.debtId ?? target?.debtId ?? debts[0]?.id ?? '');

  function debtName(debtId: string): string {
    return debts.find((debt) => debt.id === debtId)?.name ?? 'Archived debt';
  }

  async function loadData(initial = false): Promise<void> {
    if (initial) loading = true;
    error = '';
    const [planReview, activeDebts, history, settings] = await Promise.all([
      planService.getActivePlanReview(),
      debtService.listActive(),
      paymentService.history(),
      planService.getSettings()
    ]);
    review = planReview;
    debts = activeDebts;
    recentPayments = history.recent;
    totalPaidMinor = history.totalPaidMinor;
    currency = settings?.currency ?? 'GBP';
    reviewVisible = Boolean(planReview?.isStale);
    if (initial) loading = false;
  }

  onMount(async () => {
    try {
      await loadData(true);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Your active plan could not be loaded.';
      loading = false;
    }
  });

  function openPayment(): void {
    statusMessage = '';
    paymentOpen = true;
  }

  async function closePayment(): Promise<void> {
    paymentOpen = false;
    await tick();
    recordButton?.focus();
  }

  async function recordPayment(value: PaymentFormSubmission): Promise<void> {
    const payment = await paymentService.record(value);
    latestPayment = payment;
    paymentOpen = false;
    try {
      await loadData();
      reviewVisible = true;
      await tick();
      reviewPanel?.focus();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The updated plan could not be reviewed.';
    }
  }

  async function saveReconciliation(value: BalanceReconciliationSubmission): Promise<void> {
    await debtService.reconcileBalance({ ...value, source: 'statement' });
    reconciliationOpen = false;
    await loadData();
    reviewVisible = true;
    await tick();
    reviewPanel?.focus();
  }

  async function showReview(): Promise<void> {
    reviewVisible = true;
    await tick();
    reviewPanel?.focus();
  }

  async function activateUpdatedPlan(): Promise<void> {
    if (!review?.currentProjection) return;
    updatingPlan = true;
    error = '';
    try {
      await scenarioService.createAndActivate({
        name: 'Updated payment plan',
        monthlyBudgetMinor: review.scenario.monthlyBudgetMinor,
        startMonth: review.scenario.startMonth,
        algorithm: review.scenario.algorithm,
        sourceScenarioId: review.scenario.id
      });
      latestPayment = null;
      reconciliationOpen = false;
      await loadData();
      statusMessage = memoryOnly
        ? 'Your updated plan is now active for this session.'
        : 'Your updated plan is now active and saved on this device.';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The updated plan could not be activated.';
    } finally {
      updatingPlan = false;
    }
  }

  function modal(node: HTMLDialogElement) {
    node.showModal();
    return {
      destroy() {
        if (node.open) node.close();
      }
    };
  }

  function handleDialogKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      void closePayment();
    }
  }
</script>

<svelte:head>
  <title>Home | Debt Tracker</title>
</svelte:head>

<div class="page-stack home-dashboard">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Your debt-free plan</p>
      <h1>Know exactly what to pay next.</h1>
      <p>Record what you paid, check the balance, and keep your plan current.</p>
    </div>
  </section>

  {#if loading}
    <section class="action-card" aria-live="polite">Loading your next payment…</section>
  {:else if error && !review}
    <p class="form-error" role="alert">{error}</p>
  {:else if review && displayProjection && target}
    <section class="action-card" aria-labelledby="next-payment-title">
      <div class="action-icon"><Target size={28} strokeWidth={1.8} aria-hidden="true" /></div>
      <div class="action-copy">
        <p class="card-label">
          {review.isStale ? 'Updated recommendation' : 'Recommended this month'}
        </p>
        <h2 id="next-payment-title">
          Pay {formatMoney(target.paymentMinor, currency)} to {target.name}
        </h2>
        <p>
          {review.isStale
            ? 'Review how your latest payment or balance changed the plan before recording another.'
            : 'This includes the minimum payment and the extra amount available for your current target.'}
        </p>
      </div>
      <div class="action-buttons">
        {#if review.isStale}
          <button class="button primary home-payment-cta" type="button" onclick={showReview}>
            Review changes <ArrowRight size={18} aria-hidden="true" />
          </button>
        {:else}
          <button
            bind:this={recordButton}
            class="button primary home-payment-cta"
            type="button"
            onclick={openPayment}
          >
            <CreditCard size={18} aria-hidden="true" /> Record payment
          </button>
        {/if}
        <a class="button secondary" href={resolve('/plan')}>View full plan</a>
      </div>
    </section>

    {#if review.isStale && reviewVisible}
      <section
        bind:this={reviewPanel}
        class="plan-review-card"
        tabindex="-1"
        aria-labelledby="plan-review-title"
        aria-live="polite"
      >
        <div class="review-heading">
          <div>
            <p class="eyebrow">Confirmation required</p>
            <h2 id="plan-review-title">Review your updated plan</h2>
            <p>Your current active plan stays unchanged until you accept this update.</p>
          </div>
          <span class="review-icon"><RefreshCw size={21} aria-hidden="true" /></span>
        </div>

        {#if latestPayment}
          <div class="estimated-balance">
            <span>Estimated balance after payment</span>
            <strong>{formatMoney(latestPayment.estimatedBalanceAfterMinor, currency)}</strong>
            <small>{debtName(latestPayment.debtId)}</small>
          </div>
        {/if}

        {#if review.currentFailure}
          <p class="form-error" role="alert">
            {review.currentFailure.code === 'NO_DEBTS'
              ? 'All current balances are paid. No replacement plan is needed.'
              : review.currentFailure.message}
          </p>
        {:else}
          <ul class="change-list" aria-label="Changes to your plan">
            {#each explanations as explanation (explanation.key)}
              <li>
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>{explanation.message}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if reconciliationOpen}
          <div class="reconciliation-panel">
            <div>
              <h3>Replace the estimate with a statement balance</h3>
              <p>This updates the draft again before you decide whether to make it active.</p>
            </div>
            {#key reviewDebtId}
              <BalanceReconciliationForm
                {debts}
                {currency}
                defaultDebtId={reviewDebtId}
                onsave={saveReconciliation}
                oncancel={() => (reconciliationOpen = false)}
              />
            {/key}
          </div>
        {:else}
          <button
            class="button secondary"
            type="button"
            onclick={() => (reconciliationOpen = true)}
          >
            <RefreshCw size={17} aria-hidden="true" /> Enter statement balance
          </button>
        {/if}

        <div class="review-actions">
          <button class="button secondary" type="button" onclick={() => (reviewVisible = false)}>
            Review later
          </button>
          <button
            class="button primary"
            type="button"
            onclick={activateUpdatedPlan}
            disabled={updatingPlan || !review.currentProjection}
          >
            {updatingPlan ? 'Updating…' : 'Use updated plan'}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </section>
    {/if}

    {#if error}<p class="form-error" role="alert">{error}</p>{/if}
    {#if statusMessage}<p class="success-message" role="status">{statusMessage}</p>{/if}

    <section class="home-section" aria-labelledby="other-payments-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Also this month</p>
          <h2 id="other-payments-title">Other minimum payments</h2>
        </div>
        <span>{formatYearMonth(firstMonth?.month ?? displayProjection.startMonth)}</span>
      </div>
      {#if otherMinimums.length}
        <ul class="minimum-payment-list">
          {#each otherMinimums as debt (debt.debtId)}
            <li>
              <span>{debt.name}</span>
              <strong>{formatMoney(debt.requiredPaymentMinor, currency)}</strong>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-copy">There are no other minimum payments in this plan month.</p>
      {/if}
    </section>

    <section class="metric-grid" aria-label="Plan progress">
      <article class="metric-card">
        <span class="metric-icon"><WalletCards size={19} aria-hidden="true" /></span>
        <p>Total debt</p>
        <strong>{formatMoney(totalDebtMinor, currency)}</strong>
        <span
          >Across {debts.filter((debt) => debt.currentBalanceMinor > 0).length} active debts.</span
        >
      </article>
      <article class="metric-card">
        <span class="metric-icon"><CalendarDays size={19} aria-hidden="true" /></span>
        <p>Debt-free estimate</p>
        <strong>{formatYearMonth(displayProjection.debtFreeMonth)}</strong>
        <span>{displayProjection.durationMonths} projected monthly payments.</span>
      </article>
      <article class="metric-card">
        <span class="metric-icon"><TrendingDown size={19} aria-hidden="true" /></span>
        <p>Payments recorded</p>
        <strong>{formatMoney(totalPaidMinor, currency)}</strong>
        <span
          >Based on the payments {memoryOnly ? 'in this session' : 'saved in this browser'}.</span
        >
      </article>
    </section>

    <div class="home-detail-grid">
      <section class="home-section" aria-labelledby="next-milestone-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Coming up</p>
            <h2 id="next-milestone-title">Next payoff milestone</h2>
          </div>
          <Target size={20} aria-hidden="true" />
        </div>
        {#if nextMilestone}
          <div class="milestone-summary">
            <strong>{nextMilestone.name}</strong>
            <span>Projected paid off {formatYearMonth(nextMilestone.payoffMonth)}</span>
            <dl>
              <div>
                <dt>Final payment</dt>
                <dd>{formatMoney(nextMilestone.finalPaymentMinor, currency)}</dd>
              </div>
              <div>
                <dt>Available to next debt</dt>
                <dd>{formatMoney(nextMilestone.nextTargetPaymentMinor, currency)}</dd>
              </div>
            </dl>
          </div>
        {/if}
      </section>

      <section class="home-section" aria-labelledby="recent-payments-title">
        <div class="section-heading">
          <div>
            <p class="eyebrow">{memoryOnly ? 'Session history' : 'Saved history'}</p>
            <h2 id="recent-payments-title">Recent payments</h2>
          </div>
          <History size={20} aria-hidden="true" />
        </div>
        {#if recentPayments.length}
          <ul class="payment-history-list">
            {#each recentPayments as payment (payment.id)}
              <li>
                <div>
                  <strong>{debtName(payment.debtId)}</strong>
                  <span>{formatCalendarDate(payment.paidOn)}</span>
                </div>
                <strong>{formatMoney(payment.amountMinor, currency)}</strong>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="empty-copy">Your recorded payments will appear here.</p>
        {/if}
      </section>
    </div>
  {/if}

  <section class="notice-card">
    <LockKeyhole size={20} aria-hidden="true" />
    <div>
      <h2>Your data stays here</h2>
      <p>Payments and balances remain in this browser. Create a protected backup from Settings.</p>
    </div>
  </section>
</div>

{#if paymentOpen && target}
  <div class="dialog-backdrop">
    <dialog
      use:modal
      class="payment-dialog"
      aria-modal="true"
      aria-labelledby="payment-dialog-title"
      onkeydown={handleDialogKeydown}
    >
      <div class="dialog-heading">
        <div>
          <p class="eyebrow">Monthly check-in</p>
          <h2 id="payment-dialog-title">Record a payment</h2>
          <p>The recommended debt and amount are already filled in.</p>
        </div>
        <span class="action-icon"><CreditCard size={22} aria-hidden="true" /></span>
      </div>
      <PaymentForm
        {debts}
        {currency}
        defaultDebtId={target.debtId}
        defaultAmountMinor={target.paymentMinor}
        {suggestedAmounts}
        onsave={recordPayment}
        oncancel={closePayment}
      />
    </dialog>
  </div>
{/if}
