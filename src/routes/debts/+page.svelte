<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    AlertTriangle,
    Archive,
    CalendarDays,
    Pencil,
    Plus,
    WalletCards,
    X
  } from '@lucide/svelte';
  import DebtForm, { type DebtFormSubmission } from '$lib/components/debts/DebtForm.svelte';
  import { DebtService, PlanService } from '$lib/application';
  import { getDatabase, type Debt } from '$lib/persistence';
  import { formatMoney } from '$lib/utils/money';
  import type { Currency } from '$lib/domain';

  const database = getDatabase();
  const debtService = new DebtService(database);
  const planService = new PlanService(database);

  let debts = $state<Debt[]>([]);
  let currency = $state<Currency>('GBP');
  let loading = $state(true);
  let pageError = $state('');
  let formOpen = $state(false);
  let editingDebt = $state<Debt | null>(null);
  let archiveCandidate = $state<Debt | null>(null);
  let formPanel = $state<HTMLElement>();
  let totalBalance = $derived(debts.reduce((total, debt) => total + debt.currentBalanceMinor, 0));
  let totalMinimums = $derived(debts.reduce((total, debt) => total + debt.minimumPaymentMinor, 0));

  async function refresh(): Promise<void> {
    debts = await debtService.listActive();
  }

  onMount(async () => {
    try {
      const settings = await planService.getSettings();
      currency = settings?.currency ?? 'GBP';
      await refresh();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'Your debts could not be loaded.';
    } finally {
      loading = false;
    }
  });

  async function focusForm(): Promise<void> {
    await tick();
    formPanel?.focus();
  }

  async function openNew(): Promise<void> {
    editingDebt = null;
    formOpen = true;
    archiveCandidate = null;
    await focusForm();
  }

  async function openEdit(debt: Debt): Promise<void> {
    editingDebt = debt;
    formOpen = true;
    archiveCandidate = null;
    await focusForm();
  }

  function closeForm(): void {
    formOpen = false;
    editingDebt = null;
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
    await refresh();
    closeForm();
  }

  async function archiveDebt(): Promise<void> {
    if (!archiveCandidate) return;
    pageError = '';
    try {
      await debtService.archive(archiveCandidate.id);
      archiveCandidate = null;
      await refresh();
    } catch (error) {
      pageError = error instanceof Error ? error.message : 'The debt could not be archived.';
    }
  }

  function formatApr(aprBasisPoints: number | null): string {
    return aprBasisPoints === null ? 'APR unknown' : `${(aprBasisPoints / 100).toFixed(2)}% APR`;
  }
</script>

<svelte:head>
  <title>Debts | Debt Tracker</title>
</svelte:head>

<div class="page-stack debts-page">
  <section class="page-heading heading-row">
    <div>
      <p class="eyebrow">Your balances</p>
      <h1>Debts</h1>
      <p>Keep balances, APRs, and minimum payments accurate as your plan changes.</p>
    </div>
    <button class="button primary" type="button" onclick={openNew}>
      <Plus size={18} aria-hidden="true" /> Add debt
    </button>
  </section>

  {#if pageError}<p class="form-error" role="alert">{pageError}</p>{/if}

  {#if loading}
    <section class="empty-state" aria-live="polite">Loading debts…</section>
  {:else}
    <section class="debt-summary" aria-label="Debt totals">
      <div><span>Total balance</span><strong>{formatMoney(totalBalance, currency)}</strong></div>
      <div>
        <span>Monthly minimums</span><strong>{formatMoney(totalMinimums, currency)}</strong>
      </div>
      <div><span>Active debts</span><strong>{debts.length}</strong></div>
    </section>

    {#if formOpen}
      <section
        class="form-panel"
        bind:this={formPanel}
        tabindex="-1"
        aria-labelledby="debt-form-title"
      >
        <div class="panel-heading">
          <div>
            <p class="eyebrow">{editingDebt ? 'Update balance and details' : 'Add to your plan'}</p>
            <h2 id="debt-form-title">{editingDebt ? `Edit ${editingDebt.name}` : 'New debt'}</h2>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="Close debt form"
            onclick={closeForm}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {#key editingDebt?.id ?? 'new-debt'}
          <DebtForm debt={editingDebt} {currency} onsave={saveDebt} oncancel={closeForm} />
        {/key}
      </section>
    {/if}

    {#if debts.length === 0}
      <section class="empty-state">
        <span class="empty-icon"
          ><WalletCards size={30} strokeWidth={1.6} aria-hidden="true" /></span
        >
        <h2>No active debts</h2>
        <p>Add a debt to include it in your next plan review.</p>
        <button class="button primary" type="button" onclick={openNew}>
          <Plus size={17} aria-hidden="true" /> Add debt
        </button>
      </section>
    {:else}
      <section class="debt-list" aria-label="Active debts">
        {#each debts as debt (debt.id)}
          <article class="debt-row">
            <div class="debt-primary">
              <span class="debt-type">{debt.type.replace('-', ' ')}</span>
              <h2>{debt.name}</h2>
              <span class="debt-meta">{formatApr(debt.aprBasisPoints)}</span>
            </div>
            <div class="debt-amount">
              <span>Balance</span>
              <strong>{formatMoney(debt.currentBalanceMinor, currency)}</strong>
            </div>
            <div class="debt-amount">
              <span>Minimum</span>
              <strong>{formatMoney(debt.minimumPaymentMinor, currency)}</strong>
            </div>
            <div class="debt-due">
              <CalendarDays size={16} aria-hidden="true" />
              <span>{debt.dueDay ? `Due day ${debt.dueDay}` : 'No due day'}</span>
            </div>
            <div class="debt-actions">
              <button
                class="button secondary compact-button"
                type="button"
                onclick={() => openEdit(debt)}
              >
                <Pencil size={16} aria-hidden="true" /> Edit
              </button>
              <button
                class="icon-button"
                type="button"
                aria-label={`Archive ${debt.name}`}
                onclick={() => (archiveCandidate = debt)}
              >
                <Archive size={17} aria-hidden="true" />
              </button>
            </div>
          </article>
        {/each}
      </section>
      <div class="notice-card">
        <AlertTriangle size={20} aria-hidden="true" />
        <div>
          <h2>Plan review required after changes</h2>
          <p>Your current plan stays unchanged until you review and accept an updated one.</p>
        </div>
      </div>
    {/if}
  {/if}

  {#if archiveCandidate}
    <dialog
      open
      class="confirmation-bar"
      aria-labelledby="archive-title"
      aria-describedby="archive-copy"
    >
      <div>
        <h2 id="archive-title">Archive {archiveCandidate.name}?</h2>
        <p id="archive-copy">
          It will leave future projections, but its payment history stays on this device.
        </p>
      </div>
      <div class="confirmation-actions">
        <button class="button secondary" type="button" onclick={() => (archiveCandidate = null)}
          >Keep debt</button
        >
        <button class="button danger-button" type="button" onclick={archiveDebt}
          >Archive debt</button
        >
      </div>
    </dialog>
  {/if}
</div>
