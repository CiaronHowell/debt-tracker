<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    AlertTriangle,
    Archive,
    CalendarClock,
    CheckCircle2,
    CreditCard,
    Pencil,
    Plus,
    WalletCards,
    X
  } from '@lucide/svelte';
  import { PayLaterService, PlanService, type PayLaterPlanView } from '$lib/application';
  import PayLaterForm, {
    type PayLaterFormSubmission
  } from '$lib/components/pay-later/PayLaterForm.svelte';
  import PayLaterPaymentForm, {
    type PayLaterPaymentFormSubmission
  } from '$lib/components/pay-later/PayLaterPaymentForm.svelte';
  import type { Currency } from '$lib/domain';
  import { getDatabase, type PayLaterPlan } from '$lib/persistence';
  import { currentLocalDate, formatCalendarDate } from '$lib/utils/dates';
  import { formatMoney } from '$lib/utils/money';

  const database = getDatabase();
  const payLaterService = new PayLaterService(database);
  const planService = new PlanService(database);

  let plans = $state<PayLaterPlanView[]>([]);
  let currency = $state<Currency>('GBP');
  let loading = $state(true);
  let pageError = $state('');
  let statusMessage = $state('');
  let formOpen = $state(false);
  let editingPlan = $state<PayLaterPlan | null>(null);
  let paymentPlan = $state<PayLaterPlanView | null>(null);
  let archiveCandidate = $state<PayLaterPlan | null>(null);
  let formPanel = $state<HTMLElement>();

  let totalBalanceMinor = $derived(
    plans.reduce((total, item) => total + item.plan.currentBalanceMinor, 0)
  );
  let monthlyAllocationMinor = $derived(
    plans.reduce((total, item) => total + item.schedule.monthlyTargetMinor, 0)
  );
  let overdueCount = $derived(plans.filter((item) => item.schedule.status === 'overdue').length);

  async function refresh(): Promise<void> {
    plans = await payLaterService.workspace(currentLocalDate());
  }

  onMount(async () => {
    try {
      const [settings] = await Promise.all([planService.getSettings(), refresh()]);
      currency = settings?.currency ?? 'GBP';
    } catch (cause) {
      pageError =
        cause instanceof Error ? cause.message : 'Your pay-later plans could not be loaded.';
    } finally {
      loading = false;
    }
  });

  async function focusPanel(): Promise<void> {
    await tick();
    formPanel?.focus();
  }

  async function openNew(): Promise<void> {
    editingPlan = null;
    paymentPlan = null;
    archiveCandidate = null;
    formOpen = true;
    statusMessage = '';
    await focusPanel();
  }

  async function openEdit(plan: PayLaterPlan): Promise<void> {
    editingPlan = plan;
    paymentPlan = null;
    archiveCandidate = null;
    formOpen = true;
    statusMessage = '';
    await focusPanel();
  }

  async function openPayment(item: PayLaterPlanView): Promise<void> {
    paymentPlan = item;
    editingPlan = null;
    formOpen = false;
    archiveCandidate = null;
    statusMessage = '';
    await focusPanel();
  }

  function closePanels(): void {
    formOpen = false;
    editingPlan = null;
    paymentPlan = null;
  }

  async function savePlan(value: PayLaterFormSubmission): Promise<void> {
    if (editingPlan) {
      await payLaterService.update(editingPlan.id, {
        name: value.name,
        currentBalanceMinor: value.balanceMinor,
        purchaseDate: value.purchaseDate,
        deadlineDate: value.deadlineDate,
        missedDeadlineAprBasisPoints: value.missedDeadlineAprBasisPoints,
        notes: value.notes
      });
      statusMessage = `${value.name} was updated.`;
    } else {
      await payLaterService.create({
        name: value.name,
        startingBalanceMinor: value.balanceMinor,
        purchaseDate: value.purchaseDate,
        deadlineDate: value.deadlineDate,
        missedDeadlineAprBasisPoints: value.missedDeadlineAprBasisPoints,
        notes: value.notes
      });
      statusMessage = `${value.name} was added to your separate pay-later plan.`;
    }
    await refresh();
    closePanels();
  }

  async function recordPayment(value: PayLaterPaymentFormSubmission): Promise<void> {
    if (!paymentPlan) return;
    const name = paymentPlan.plan.name;
    await payLaterService.recordPayment({ planId: paymentPlan.plan.id, ...value });
    await refresh();
    closePanels();
    statusMessage = `Payment recorded for ${name}. The amount to set aside each month was recalculated.`;
  }

  async function archivePlan(): Promise<void> {
    if (!archiveCandidate) return;
    pageError = '';
    try {
      const name = archiveCandidate.name;
      await payLaterService.archive(archiveCandidate.id);
      archiveCandidate = null;
      await refresh();
      statusMessage = `${name} was archived.`;
    } catch (cause) {
      pageError =
        cause instanceof Error ? cause.message : 'The pay-later plan could not be archived.';
    }
  }

  function statusLabel(item: PayLaterPlanView): string {
    switch (item.schedule.status) {
      case 'paid':
        return 'Paid off';
      case 'overdue':
        return 'Deadline passed';
      case 'catch-up':
        return 'Catch-up needed';
      default:
        return 'On track';
    }
  }

  function targetCopy(item: PayLaterPlanView): string {
    if (item.schedule.status === 'paid') return 'Nothing more to set aside.';
    if (item.schedule.status === 'overdue') return 'Review the latest balance with your provider.';
    const months = item.schedule.paymentMonthsRemaining;
    return `${months} monthly ${months === 1 ? 'payment' : 'payments'} left, including the deadline month.`;
  }
</script>

<svelte:head>
  <title>Pay later | Debt Tracker</title>
</svelte:head>

<div class="page-stack pay-later-page">
  <section class="page-heading heading-row">
    <div>
      <p class="eyebrow">Separate commitments</p>
      <h1>Pay later</h1>
      <p>
        Set aside enough for buy-now-pay-later purchases without changing your core debt budget or
        snowball order.
      </p>
    </div>
    <button class="button primary" type="button" onclick={openNew}>
      <Plus size={18} aria-hidden="true" /> Add pay-later plan
    </button>
  </section>

  <section class="pay-later-separation-note" aria-label="Budget separation">
    <WalletCards size={21} aria-hidden="true" />
    <div>
      <strong>Kept separate from your debt-free plan</strong>
      <span>This amount never reduces or redirects your snowball budget.</span>
    </div>
  </section>

  {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}
  {#if statusMessage}<p class="success-message" role="status">{statusMessage}</p>{/if}

  {#if loading}
    <section class="empty-state" aria-live="polite">Loading pay-later plans…</section>
  {:else}
    <section class="debt-summary pay-later-summary" aria-label="Pay-later totals">
      <div>
        <span>Remaining balance</span><strong>{formatMoney(totalBalanceMinor, currency)}</strong>
      </div>
      <div>
        <span>Set aside each month</span>
        <strong>{formatMoney(monthlyAllocationMinor, currency)}</strong>
      </div>
      <div>
        <span>Active plans</span><strong>{plans.length}</strong>
        {#if overdueCount}<small>{overdueCount} past deadline</small>{/if}
      </div>
    </section>

    {#if formOpen}
      <section
        class="form-panel"
        bind:this={formPanel}
        tabindex="-1"
        aria-labelledby="pay-later-form-title"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{editingPlan ? 'Update commitment' : 'New commitment'}</p>
            <h2 id="pay-later-form-title">
              {editingPlan ? `Edit ${editingPlan.name}` : 'Add a pay-later plan'}
            </h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close pay-later form"
            onclick={closePanels}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {#key editingPlan?.id ?? 'new-pay-later-plan'}
          <PayLaterForm plan={editingPlan} {currency} onsave={savePlan} oncancel={closePanels} />
        {/key}
      </section>
    {/if}

    {#if paymentPlan}
      <section
        class="form-panel"
        bind:this={formPanel}
        tabindex="-1"
        aria-labelledby="pay-later-payment-title"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Update progress</p>
            <h2 id="pay-later-payment-title">Record payment to {paymentPlan.plan.name}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close payment form"
            onclick={closePanels}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <PayLaterPaymentForm
          plan={paymentPlan.plan}
          {currency}
          defaultAmountMinor={paymentPlan.schedule.monthlyTargetMinor}
          onsave={recordPayment}
          oncancel={closePanels}
        />
      </section>
    {/if}

    {#if plans.length === 0}
      <section class="empty-state">
        <span class="empty-icon"
          ><CalendarClock size={30} strokeWidth={1.6} aria-hidden="true" /></span
        >
        <h2>No pay-later plans</h2>
        <p>Add a purchase with a payoff deadline to calculate how much to set aside each month.</p>
        <button class="button primary" type="button" onclick={openNew}>
          <Plus size={17} aria-hidden="true" /> Add pay-later plan
        </button>
      </section>
    {:else}
      <section class="pay-later-list" aria-label="Active pay-later plans">
        {#each plans as item (item.plan.id)}
          <article class="pay-later-card" class:deadline-risk={item.schedule.status === 'overdue'}>
            <div class="pay-later-card-heading">
              <div>
                <span
                  class:warning={item.schedule.status === 'overdue' ||
                    item.schedule.status === 'catch-up'}
                  class="pay-later-status"
                >
                  {#if item.schedule.status === 'overdue' || item.schedule.status === 'catch-up'}
                    <AlertTriangle size={14} aria-hidden="true" />
                  {:else}
                    <CheckCircle2 size={14} aria-hidden="true" />
                  {/if}
                  {statusLabel(item)}
                </span>
                <h2>{item.plan.name}</h2>
                <span class="pay-later-deadline">
                  <CalendarClock size={15} aria-hidden="true" /> Pay in full by {formatCalendarDate(
                    item.plan.deadlineDate
                  )}
                </span>
              </div>
              <div class="pay-later-balance">
                <span>Remaining</span>
                <strong>{formatMoney(item.plan.currentBalanceMinor, currency)}</strong>
              </div>
            </div>

            <div class="pay-later-progress" aria-label={`${item.plan.name} progress`}>
              <div>
                <span>Progress</span><strong>{item.schedule.progressPercent}%</strong>
              </div>
              <div
                class="pay-later-progress-track"
                role="progressbar"
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={item.schedule.progressPercent}
              >
                <span style={`width: ${item.schedule.progressPercent}%`}></span>
              </div>
            </div>

            <div class="pay-later-target">
              <div>
                <span
                  >{item.schedule.status === 'overdue'
                    ? 'Outstanding now'
                    : 'Set aside each month'}</span
                >
                <strong>{formatMoney(item.schedule.monthlyTargetMinor, currency)}</strong>
              </div>
              <p>{targetCopy(item)}</p>
            </div>

            {#if item.plan.missedDeadlineAprBasisPoints !== null}
              <p class="pay-later-interest-note">
                If this is not paid off by {formatCalendarDate(item.plan.deadlineDate)}, the
                provider may charge interest at {(
                  item.plan.missedDeadlineAprBasisPoints / 100
                ).toFixed(2)}% a year (APR). Some providers backdate interest to the purchase date
                or calculate it from the original balance. Check your agreement for the exact terms.
              </p>
            {/if}

            <div class="pay-later-actions">
              {#if item.plan.currentBalanceMinor > 0}
                <button class="button primary" type="button" onclick={() => openPayment(item)}>
                  <CreditCard size={17} aria-hidden="true" /> Record payment
                </button>
              {/if}
              <button class="button secondary" type="button" onclick={() => openEdit(item.plan)}>
                <Pencil size={17} aria-hidden="true" /> Edit
              </button>
              <button
                class="icon-button danger"
                type="button"
                aria-label={`Archive ${item.plan.name}`}
                onclick={() => (archiveCandidate = item.plan)}
              >
                <Archive size={18} aria-hidden="true" />
              </button>
            </div>
          </article>
        {/each}
      </section>
    {/if}
  {/if}
</div>

{#if archiveCandidate}
  <section class="confirmation-bar" aria-live="assertive" aria-labelledby="archive-pay-later-title">
    <div>
      <h2 id="archive-pay-later-title">Archive {archiveCandidate.name}?</h2>
      <p>
        Its payment history stays in backups, but it will no longer count toward what you set aside
        each month.
      </p>
    </div>
    <div class="confirmation-actions">
      <button class="button secondary" type="button" onclick={() => (archiveCandidate = null)}
        >Keep it</button
      >
      <button class="button primary" type="button" onclick={archivePlan}>Archive plan</button>
    </div>
  </section>
{/if}
