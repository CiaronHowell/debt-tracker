<script lang="ts">
  import { onMount } from 'svelte';
  import { CreditCard, X } from '@lucide/svelte';
  import type { Currency } from '$lib/domain';
  import type { Debt } from '$lib/persistence';
  import { currentLocalDate } from '$lib/utils/dates';
  import { currencySymbol, formatMoneyInput, parseMoneyInput } from '$lib/utils/money';

  export interface PaymentFormSubmission {
    debtId: string;
    amountMinor: number;
    paidOn: string;
    note: string;
  }

  interface Props {
    debts: Debt[];
    currency: Currency;
    defaultDebtId: string;
    defaultAmountMinor: number;
    suggestedAmounts?: Record<string, number>;
    onsave: (value: PaymentFormSubmission) => Promise<void>;
    oncancel: () => void;
  }

  let {
    debts,
    currency,
    defaultDebtId,
    defaultAmountMinor,
    suggestedAmounts = {},
    onsave,
    oncancel
  }: Props = $props();

  function initialState(debtId: string, amountMinor: number) {
    return { debtId, amount: formatMoneyInput(amountMinor) };
  }

  // The parent creates a fresh form for each opened payment dialog.
  // svelte-ignore state_referenced_locally
  const initial = initialState(defaultDebtId, defaultAmountMinor);
  let debtId = $state(initial.debtId);
  let amount = $state(initial.amount);
  let paidOn = $state(currentLocalDate());
  let note = $state('');
  let amountInput = $state<HTMLInputElement>();
  let errors = $state<Record<string, string>>({});
  let submitError = $state('');
  let saving = $state(false);

  onMount(() => amountInput?.focus());

  function selectDebt(event: Event): void {
    debtId = (event.currentTarget as HTMLSelectElement).value;
    const suggested =
      suggestedAmounts[debtId] ?? debts.find((debt) => debt.id === debtId)?.minimumPaymentMinor;
    if (suggested !== undefined) amount = formatMoneyInput(suggested);
  }

  function validate(): PaymentFormSubmission | null {
    const nextErrors: Record<string, string> = {};
    const amountMinor = parseMoneyInput(amount);

    if (!debts.some((debt) => debt.id === debtId)) nextErrors.debtId = 'Choose an active debt.';
    if (amountMinor === null || amountMinor <= 0) {
      nextErrors.amount = 'Enter a payment greater than 0 with up to two decimal places.';
    }
    if (!paidOn) nextErrors.paidOn = 'Choose the date you made this payment.';
    if (note.length > 2_000) nextErrors.note = 'Notes must be 2,000 characters or fewer.';

    errors = nextErrors;
    if (Object.keys(nextErrors).length || amountMinor === null) return null;
    return { debtId, amountMinor, paidOn, note };
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
      submitError = error instanceof Error ? error.message : 'The payment could not be recorded.';
    } finally {
      saving = false;
    }
  }
</script>

<form class="payment-form" novalidate onsubmit={submit}>
  <div class="field-group">
    <label for="payment-debt">Debt</label>
    <select
      id="payment-debt"
      name="debtId"
      value={debtId}
      onchange={selectDebt}
      aria-invalid={errors.debtId ? 'true' : undefined}
      aria-describedby={errors.debtId ? 'payment-debt-error' : undefined}
    >
      {#each debts as debt (debt.id)}
        <option value={debt.id}>{debt.name}</option>
      {/each}
    </select>
    {#if errors.debtId}<p class="field-error" id="payment-debt-error">{errors.debtId}</p>{/if}
  </div>

  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="payment-amount">Payment amount ({currencySymbol(currency)})</label>
      <input
        bind:this={amountInput}
        id="payment-amount"
        name="amount"
        type="text"
        inputmode="decimal"
        bind:value={amount}
        aria-invalid={errors.amount ? 'true' : undefined}
        aria-describedby={errors.amount ? 'payment-amount-error' : 'payment-amount-hint'}
      />
      <p class="field-hint" id="payment-amount-hint">Change this if you paid a different amount.</p>
      {#if errors.amount}<p class="field-error" id="payment-amount-error">{errors.amount}</p>{/if}
    </div>

    <div class="field-group">
      <label for="payment-date">Paid on</label>
      <input
        id="payment-date"
        name="paidOn"
        type="date"
        bind:value={paidOn}
        aria-invalid={errors.paidOn ? 'true' : undefined}
        aria-describedby={errors.paidOn ? 'payment-date-error' : undefined}
      />
      {#if errors.paidOn}<p class="field-error" id="payment-date-error">{errors.paidOn}</p>{/if}
    </div>
  </div>

  <div class="field-group">
    <label for="payment-note">Note <span class="optional">Optional</span></label>
    <textarea
      id="payment-note"
      name="note"
      rows="2"
      maxlength="2000"
      bind:value={note}
      aria-invalid={errors.note ? 'true' : undefined}
      aria-describedby={errors.note ? 'payment-note-error' : undefined}></textarea>
    {#if errors.note}<p class="field-error" id="payment-note-error">{errors.note}</p>{/if}
  </div>

  {#if submitError}<p class="form-error" role="alert">{submitError}</p>{/if}

  <div class="form-actions">
    <button class="button secondary" type="button" onclick={oncancel} disabled={saving}>
      <X size={17} aria-hidden="true" /> Cancel
    </button>
    <button class="button primary" type="submit" disabled={saving}>
      <CreditCard size={17} aria-hidden="true" />
      {saving ? 'Recording…' : 'Record payment'}
    </button>
  </div>
</form>
