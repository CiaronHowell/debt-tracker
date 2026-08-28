<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    ArrowLeft,
    ArrowRight,
    Check,
    CircleCheck,
    Database,
    Pencil,
    Plus,
    ShieldCheck,
    Trash2,
    WalletCards
  } from '@lucide/svelte';
  import { calculatePlan, type Currency } from '$lib/domain';
  import DebtForm, { type DebtFormSubmission } from '$lib/components/debts/DebtForm.svelte';
  import { DebtService, PlanService, ScenarioService } from '$lib/application';
  import { getDatabase, getPersistenceMode, type Debt, type PlanSettings } from '$lib/persistence';
  import { currentLocalMonth, formatYearMonth } from '$lib/utils/dates';
  import { formatMoney, formatMoneyInput, parseMoneyInput } from '$lib/utils/money';

  const database = getDatabase();
  const memoryOnly = getPersistenceMode() === 'memory';
  const debtService = new DebtService(database);
  const planService = new PlanService(database);
  const scenarioService = new ScenarioService(database);
  const steps = ['Privacy', 'Debts', 'Budget', 'Review'] as const;

  let loading = $state(true);
  let step = $state(1);
  let debts = $state<Debt[]>([]);
  let settings = $state<PlanSettings | undefined>();
  let currency = $state<Currency>('GBP');
  let startMonth = $state(currentLocalMonth());
  let budgetInput = $state('');
  let showDebtForm = $state(false);
  let editingDebt = $state<Debt | null>(null);
  let pageError = $state('');
  let saving = $state(false);

  let minimumTotal = $derived(debts.reduce((total, debt) => total + debt.minimumPaymentMinor, 0));
  let projection = $derived.by(() => {
    if (!settings || debts.length === 0 || settings.monthlyBudgetMinor <= 0) return null;
    return calculatePlan({
      currency: settings.currency,
      startMonth: settings.startMonth,
      monthlyBudgetMinor: settings.monthlyBudgetMinor,
      debts: debts.map((debt) => ({
        debtId: debt.id,
        name: debt.name,
        balanceMinor: debt.currentBalanceMinor,
        aprBasisPoints: debt.aprBasisPoints,
        minimumPaymentMinor: debt.minimumPaymentMinor,
        createdAt: debt.createdAt,
        balanceSource: debt.balanceSource
      }))
    });
  });

  async function refreshDebts(): Promise<void> {
    debts = await debtService.listActive();
  }

  function inferStep(): number {
    if (!settings) return 1;
    if (debts.length === 0) return 2;
    if (settings.monthlyBudgetMinor < minimumTotal) return 3;
    return 4;
  }

  onMount(async () => {
    try {
      [settings] = await Promise.all([planService.getSettings(), refreshDebts()]);
      if (settings?.setupCompletedAt) {
        await goto(resolve('/'), { replaceState: true });
        return;
      }
      if (settings) {
        currency = settings.currency;
        startMonth = settings.startMonth;
        budgetInput = settings.monthlyBudgetMinor
          ? formatMoneyInput(settings.monthlyBudgetMinor)
          : '';
      }
      step = inferStep();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Setup could not be loaded.';
    } finally {
      loading = false;
    }
  });

  async function acceptPrivacy(): Promise<void> {
    saving = true;
    pageError = '';
    try {
      settings = await planService.saveSettings({
        currency,
        startMonth,
        monthlyBudgetMinor: 0
      });
      step = 2;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Setup could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function saveDebt(value: DebtFormSubmission): Promise<void> {
    if (editingDebt) {
      await debtService.update(editingDebt.id, {
        name: value.name,
        type: value.type,
        balanceMinor: value.balanceMinor,
        balanceAsOf: value.balanceAsOf,
        aprBasisPoints: value.aprBasisPoints,
        minimumPaymentMinor: value.minimumPaymentMinor,
        dueDay: value.dueDay,
        notes: value.notes,
        colorKey: null
      });
    } else {
      await debtService.create({
        name: value.name,
        type: value.type,
        startingBalanceMinor: value.balanceMinor,
        balanceAsOf: value.balanceAsOf,
        aprBasisPoints: value.aprBasisPoints,
        minimumPaymentMinor: value.minimumPaymentMinor,
        dueDay: value.dueDay,
        notes: value.notes,
        colorKey: null
      });
    }
    await refreshDebts();
    showDebtForm = false;
    editingDebt = null;
  }

  function openNewDebt(): void {
    editingDebt = null;
    showDebtForm = true;
  }

  function openEditDebt(debt: Debt): void {
    editingDebt = debt;
    showDebtForm = true;
  }

  async function removeDebt(debt: Debt): Promise<void> {
    pageError = '';
    try {
      await debtService.archive(debt.id);
      await refreshDebts();
      if (debts.length === 0) showDebtForm = true;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'The debt could not be removed.';
    }
  }

  async function saveBudget(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    pageError = '';
    const monthlyBudgetMinor = parseMoneyInput(budgetInput);
    if (monthlyBudgetMinor === null || monthlyBudgetMinor <= 0) {
      pageError = 'Enter a monthly budget greater than 0 with up to two decimal places.';
      return;
    }
    if (monthlyBudgetMinor < minimumTotal) {
      pageError = `Your budget is ${formatMoney(minimumTotal - monthlyBudgetMinor, currency)} below the required minimum payments.`;
      return;
    }

    saving = true;
    try {
      settings = await planService.saveSettings({ currency, startMonth, monthlyBudgetMinor });
      step = 4;
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'The budget could not be saved.';
    } finally {
      saving = false;
    }
  }

  async function activatePlan(): Promise<void> {
    if (!settings) return;
    saving = true;
    pageError = '';
    try {
      await scenarioService.createAndActivate({
        name: 'My debt-free plan',
        monthlyBudgetMinor: settings.monthlyBudgetMinor,
        startMonth: settings.startMonth
      });
      await goto(resolve('/'));
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'The plan could not be activated.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Set up your plan | Debt Tracker</title>
</svelte:head>

<div class="narrow-page page-stack setup-page">
  <ol class="setup-progress" aria-label="Setup progress">
    {#each steps as label, index (label)}
      <li class:current={step === index + 1} class:complete={step > index + 1}>
        <span>{step > index + 1 ? '✓' : index + 1}</span><strong>{label}</strong>
      </li>
    {/each}
  </ol>

  {#if loading}
    <section class="setup-card loading-card" aria-live="polite">Loading your saved setup…</section>
  {:else if step === 1}
    <section class="setup-card">
      <div class="setup-illustration">
        <ShieldCheck size={34} strokeWidth={1.6} aria-hidden="true" />
      </div>
      <p class="eyebrow">Before we begin</p>
      <h1>{memoryOnly ? 'Build a plan for this session.' : 'Your plan stays on this device.'}</h1>
      <p class="lead">
        There is no account and nothing is sent to a server.
        {memoryOnly
          ? ' Browser storage is unavailable, so this plan lasts only until you close the tab.'
          : ' Your debts and payment history are stored privately in this browser.'}
      </p>
      <ul class="feature-list">
        <li>
          <Check size={18} aria-hidden="true" /><span>Calculations happen in your browser</span>
        </li>
        <li>
          <Database size={18} aria-hidden="true" /><span
            >{memoryOnly
              ? 'Your progress is available for this session'
              : 'Your progress saves on this device'}</span
          >
        </li>
        <li>
          <ShieldCheck size={18} aria-hidden="true" /><span>You can create an encrypted backup</span
          >
        </li>
      </ul>
      <div class="warning-note">
        {memoryOnly
          ? 'Changes disappear when this tab closes. Export a backup from Settings before leaving.'
          : 'Clearing browser data can remove your plan. We’ll remind you to create a backup after setup.'}
      </div>
      {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}
      <button
        class="button primary full-width"
        type="button"
        onclick={acceptPrivacy}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Continue to debts'}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </section>
  {:else if step === 2}
    <section class="setup-card setup-workspace">
      <p class="eyebrow">Step 2 of 4</p>
      <h1>Add your debts</h1>
      <p class="lead">
        Use the latest balances and minimum payments you know. You can update them later.
      </p>

      {#if debts.length > 0}
        <div class="setup-debt-list" aria-label="Debts added">
          {#each debts as debt (debt.id)}
            <article class="setup-debt-row">
              <div>
                <strong>{debt.name}</strong>
                <span
                  >{formatMoney(debt.currentBalanceMinor, currency)} balance · {formatMoney(
                    debt.minimumPaymentMinor,
                    currency
                  )} minimum</span
                >
              </div>
              <div class="compact-actions">
                <button
                  class="icon-button"
                  type="button"
                  aria-label={`Edit ${debt.name}`}
                  onclick={() => openEditDebt(debt)}
                >
                  <Pencil size={17} aria-hidden="true" />
                </button>
                <button
                  class="icon-button danger"
                  type="button"
                  aria-label={`Remove ${debt.name}`}
                  onclick={() => removeDebt(debt)}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}

      {#if showDebtForm || debts.length === 0}
        <div
          class="embedded-form"
          aria-label={editingDebt ? `Edit ${editingDebt.name}` : 'Add a debt'}
        >
          <h2>{editingDebt ? `Edit ${editingDebt.name}` : 'Debt details'}</h2>
          {#key editingDebt?.id ?? 'new-debt'}
            <DebtForm
              debt={editingDebt}
              {currency}
              onsave={saveDebt}
              oncancel={debts.length
                ? () => {
                    showDebtForm = false;
                    editingDebt = null;
                  }
                : undefined}
            />
          {/key}
        </div>
      {:else}
        <button class="button secondary" type="button" onclick={openNewDebt}>
          <Plus size={17} aria-hidden="true" /> Add another debt
        </button>
      {/if}

      {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}
      <div class="setup-actions split-actions">
        <button class="button secondary" type="button" onclick={() => (step = 1)}>
          <ArrowLeft size={17} aria-hidden="true" /> Back
        </button>
        <button
          class="button primary"
          type="button"
          onclick={() => (step = 3)}
          disabled={debts.length === 0}
        >
          Continue to budget <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  {:else if step === 3}
    <section class="setup-card">
      <p class="eyebrow">Step 3 of 4</p>
      <h1>Set your monthly budget</h1>
      <p class="lead">
        Choose one amount you can reliably put towards all debt payments each month.
      </p>

      <div class="minimum-callout">
        <WalletCards size={20} aria-hidden="true" />
        <div>
          <span>Your combined minimums</span><strong
            >{formatMoney(minimumTotal, currency)} per month</strong
          >
        </div>
      </div>

      <form class="budget-form" novalidate onsubmit={saveBudget}>
        <div class="form-grid two-columns">
          <div class="field-group">
            <label for="setup-currency">Currency</label>
            <select id="setup-currency" bind:value={currency}>
              <option value="GBP">GBP — British pound</option>
              <option value="EUR">EUR — Euro</option>
              <option value="USD">USD — US dollar</option>
            </select>
          </div>
          <div class="field-group">
            <label for="setup-start-month">Plan start month</label>
            <input id="setup-start-month" type="month" bind:value={startMonth} />
          </div>
        </div>
        <div class="field-group budget-field">
          <label for="monthly-budget">Total monthly debt budget</label>
          <input
            id="monthly-budget"
            type="text"
            inputmode="decimal"
            placeholder="0.00"
            bind:value={budgetInput}
          />
          <p class="field-hint">This includes every minimum payment, plus anything extra.</p>
        </div>
        {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}
        <div class="setup-actions split-actions">
          <button class="button secondary" type="button" onclick={() => (step = 2)}>
            <ArrowLeft size={17} aria-hidden="true" /> Back
          </button>
          <button class="button primary" type="submit" disabled={saving}>
            {saving ? 'Calculating…' : 'Review my plan'}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  {:else}
    <section class="setup-card review-card">
      <div class="setup-illustration success-illustration">
        <CircleCheck size={34} strokeWidth={1.7} aria-hidden="true" />
      </div>
      <p class="eyebrow">Step 4 of 4</p>
      <h1>Your debt repayment plan is ready.</h1>
      <p class="lead">Review how paying your smallest debt first could work for you.</p>

      {#if projection?.status === 'success' && settings}
        <div class="review-metrics">
          <div>
            <span>Starting debt</span><strong
              >{formatMoney(projection.totalStartingBalanceMinor, settings.currency)}</strong
            >
          </div>
          <div>
            <span>Monthly budget</span><strong
              >{formatMoney(settings.monthlyBudgetMinor, settings.currency)}</strong
            >
          </div>
          <div>
            <span>Debt-free estimate</span><strong
              >{formatYearMonth(projection.debtFreeMonth)}</strong
            >
          </div>
        </div>
        <div class="payoff-order">
          <h2>Payoff order</h2>
          <ol>
            {#each projection.milestones as milestone (milestone.debtId)}
              <li>
                <span>{milestone.name}</span><strong
                  >{formatYearMonth(milestone.payoffMonth)}</strong
                >
              </li>
            {/each}
          </ol>
        </div>
        {#if projection.hasIncompleteInterest}
          <div class="warning-note">
            Interest totals are incomplete because one or more APRs are unknown.
          </div>
        {/if}
      {:else if projection?.status === 'failure'}
        <p class="form-error" role="alert">{projection.message}</p>
      {/if}

      <p class="estimate-note">
        This plan is an estimate. Lenders may calculate interest and fees differently.
      </p>
      {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}
      <div class="setup-actions split-actions">
        <button class="button secondary" type="button" onclick={() => (step = 3)}>
          <ArrowLeft size={17} aria-hidden="true" /> Adjust budget
        </button>
        <button
          class="button primary"
          type="button"
          onclick={activatePlan}
          disabled={saving || projection?.status !== 'success'}
        >
          {saving ? 'Activating…' : 'Make this my plan'}
          <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  {/if}
</div>
