<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { ArrowRight, CheckCircle2, LockKeyhole, Target } from '@lucide/svelte';
  import { PlanService } from '$lib/application';
  import { getDatabase } from '$lib/persistence';
  import type { Currency, PlanProjection } from '$lib/domain';
  import { formatYearMonth } from '$lib/utils/dates';
  import { formatMoney } from '$lib/utils/money';

  const planService = new PlanService(getDatabase());
  let projection = $state<PlanProjection | null>(null);
  let currency = $state<Currency>('GBP');
  let loading = $state(true);
  let error = $state('');
  let target = $derived.by(() => {
    const firstMonth = projection?.months[0];
    if (!firstMonth?.targetDebtId) return null;
    return firstMonth.debts.find((debt) => debt.debtId === firstMonth.targetDebtId) ?? null;
  });

  onMount(async () => {
    try {
      const [activeProjection, settings] = await Promise.all([
        planService.getActiveProjection(),
        planService.getSettings()
      ]);
      projection = activeProjection;
      currency = settings?.currency ?? 'GBP';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Your active plan could not be loaded.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Home | Debt Tracker</title>
</svelte:head>

<div class="page-stack">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Your debt-free plan</p>
      <h1>Know exactly what to pay next.</h1>
      <p>Your active repayment plan is saved privately on this device.</p>
    </div>
  </section>

  {#if loading}
    <section class="action-card" aria-live="polite">Loading your next payment…</section>
  {:else if error}
    <p class="form-error" role="alert">{error}</p>
  {:else if projection && target}
    <section class="action-card" aria-labelledby="next-payment-title">
      <div class="action-icon"><Target size={28} strokeWidth={1.8} aria-hidden="true" /></div>
      <div class="action-copy">
        <p class="card-label">Recommended this month</p>
        <h2 id="next-payment-title">
          Pay {formatMoney(target.paymentMinor, currency)} to {target.name}
        </h2>
        <p>This includes its minimum payment and the available snowball for your first target.</p>
      </div>
      <a class="button primary" href={resolve('/plan')}
        >View plan <ArrowRight size={18} aria-hidden="true" /></a
      >
    </section>

    <section class="metric-grid" aria-label="Plan summary">
      <article class="metric-card">
        <span class="metric-icon"><Target size={19} aria-hidden="true" /></span>
        <p>Starting balance</p>
        <strong>{formatMoney(projection.totalStartingBalanceMinor, currency)}</strong>
        <span
          >Across {projection.payoffOrder.length} active {projection.payoffOrder.length === 1
            ? 'debt'
            : 'debts'}.</span
        >
      </article>
      <article class="metric-card">
        <span class="metric-icon"><CheckCircle2 size={19} aria-hidden="true" /></span>
        <p>Debt-free estimate</p>
        <strong>{formatYearMonth(projection.debtFreeMonth)}</strong>
        <span
          >{projection.durationMonths} monthly {projection.durationMonths === 1
            ? 'payment'
            : 'payments'} projected.</span
        >
      </article>
      <article class="metric-card">
        <span class="metric-icon"><LockKeyhole size={19} aria-hidden="true" /></span>
        <p>Privacy</p>
        <strong>Saved locally</strong>
        <span>No account, analytics, or bank connection.</span>
      </article>
    </section>
  {/if}

  <section class="notice-card">
    <LockKeyhole size={20} aria-hidden="true" />
    <div>
      <h2>Your data stays here</h2>
      <p>Debt Tracker stores your plan in this browser. Create a protected backup from Settings.</p>
    </div>
  </section>
</div>
