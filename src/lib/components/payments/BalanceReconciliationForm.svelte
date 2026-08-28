<script lang="ts">
  import { onMount } from 'svelte';
  import { RefreshCw, X } from '@lucide/svelte';
  import type { Currency } from '$lib/domain';
  import type { Debt } from '$lib/persistence';
  import { currentLocalDate } from '$lib/utils/dates';
  import { currencySymbol, formatMoneyInput, parseMoneyInput } from '$lib/utils/money';

  export interface BalanceReconciliationSubmission {
    debtId: string;
    balanceMinor: number;
    recordedOn: string;
  }

  interface Props {
    debts: Debt[];
    currency: Currency;
    defaultDebtId: string;
    onsave: (value: BalanceReconciliationSubmission) => Promise<void>;
    oncancel: () => void;
  }

  let { debts, currency, defaultDebtId, onsave, oncancel }: Props = $props();
  function initialState(items: Debt[], selectedId: string) {
    const selected = items.find((debt) => debt.id === selectedId) ?? items[0];
    return {
      debtId: selected?.id ?? '',
      balance: selected ? formatMoneyInput(selected.currentBalanceMinor) : ''
    };
  }

  // The parent keys this component by the selected debt for a fresh reconciliation.
  // svelte-ignore state_referenced_locally
  const initial = initialState(debts, defaultDebtId);
  let debtId = $state(initial.debtId);
  let balance = $state(initial.balance);
  let recordedOn = $state(currentLocalDate());
  let balanceInput = $state<HTMLInputElement>();
  let errors = $state<Record<string, string>>({});
  let submitError = $state('');
  let saving = $state(false);

  onMount(() => balanceInput?.focus());

  function selectDebt(event: Event): void {
    debtId = (event.currentTarget as HTMLSelectElement).value;
    const debt = debts.find((item) => item.id === debtId);
    if (debt) balance = formatMoneyInput(debt.currentBalanceMinor);
  }

  function validate(): BalanceReconciliationSubmission | null {
    const nextErrors: Record<string, string> = {};
    const balanceMinor = parseMoneyInput(balance);
    if (!debts.some((debt) => debt.id === debtId)) nextErrors.debtId = 'Choose an active debt.';
    if (balanceMinor === null) {
      nextErrors.balance = 'Enter a balance of 0 or more with up to two decimal places.';
    }
    if (!recordedOn) nextErrors.recordedOn = 'Choose the statement date.';
    errors = nextErrors;
    if (Object.keys(nextErrors).length || balanceMinor === null) return null;
    return { debtId, balanceMinor, recordedOn };
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    submitError = '';
    const value = validate();
    if (!value) return;
    saving = true;
    try {
      await onsave(value);
    } catch (error) {
      submitError =
        error instanceof Error ? error.message : 'The statement balance could not be saved.';
    } finally {
      saving = false;
    }
  }
</script>

<form class="reconciliation-form" novalidate onsubmit={submit}>
  <div class="field-group">
    <label for="reconcile-debt">Debt</label>
    <select id="reconcile-debt" value={debtId} onchange={selectDebt}>
      {#each debts as debt (debt.id)}
        <option value={debt.id}>{debt.name}</option>
      {/each}
    </select>
  </div>

  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="statement-balance">Statement balance ({currencySymbol(currency)})</label>
      <input
        bind:this={balanceInput}
        id="statement-balance"
        type="text"
        inputmode="decimal"
        bind:value={balance}
        aria-invalid={errors.balance ? 'true' : undefined}
        aria-describedby={errors.balance ? 'statement-balance-error' : 'statement-balance-hint'}
      />
      <p class="field-hint" id="statement-balance-hint">Use the balance shown by your lender.</p>
      {#if errors.balance}<p class="field-error" id="statement-balance-error">
          {errors.balance}
        </p>{/if}
    </div>
    <div class="field-group">
      <label for="statement-date">Statement date</label>
      <input
        id="statement-date"
        type="date"
        bind:value={recordedOn}
        aria-invalid={errors.recordedOn ? 'true' : undefined}
        aria-describedby={errors.recordedOn ? 'statement-date-error' : undefined}
      />
      {#if errors.recordedOn}<p class="field-error" id="statement-date-error">
          {errors.recordedOn}
        </p>{/if}
    </div>
  </div>

  {#if submitError}<p class="form-error" role="alert">{submitError}</p>{/if}
  <div class="form-actions">
    <button class="button secondary" type="button" onclick={oncancel} disabled={saving}>
      <X size={17} aria-hidden="true" /> Cancel
    </button>
    <button class="button primary" type="submit" disabled={saving}>
      <RefreshCw size={17} aria-hidden="true" />
      {saving ? 'Saving…' : 'Use statement balance'}
    </button>
  </div>
</form>
