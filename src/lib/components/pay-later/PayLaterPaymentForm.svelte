<script lang="ts">
  import { Save, X } from '@lucide/svelte';
  import type { Currency } from '$lib/domain';
  import type { PayLaterPlan } from '$lib/persistence';
  import { currentLocalDate } from '$lib/utils/dates';
  import { currencySymbol, formatMoneyInput, parseMoneyInput } from '$lib/utils/money';

  export interface PayLaterPaymentFormSubmission {
    amountMinor: number;
    paidOn: string;
    note: string;
  }

  interface Props {
    plan: PayLaterPlan;
    currency: Currency;
    defaultAmountMinor: number;
    onsave: (value: PayLaterPaymentFormSubmission) => Promise<void>;
    oncancel: () => void;
  }

  let { plan, currency, defaultAmountMinor, onsave, oncancel }: Props = $props();
  // This component is keyed by the selected plan, so the suggested amount seeds a fresh form.
  // svelte-ignore state_referenced_locally
  let amount = $state(formatMoneyInput(defaultAmountMinor));
  let paidOn = $state(currentLocalDate());
  let note = $state('');
  let errors = $state<Record<string, string>>({});
  let submitError = $state('');
  let saving = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    const amountMinor = parseMoneyInput(amount);
    if (amountMinor === null || amountMinor <= 0) {
      nextErrors.amount = 'Enter a payment greater than 0 with up to two decimal places.';
    }
    if (!paidOn) nextErrors.paidOn = 'Choose the date you paid.';
    if (paidOn && paidOn < plan.purchaseDate) {
      nextErrors.paidOn = 'Choose a date on or after the purchase date.';
    }
    if (note.length > 2_000) nextErrors.note = 'Notes must be 2,000 characters or fewer.';
    errors = nextErrors;
    if (Object.keys(nextErrors).length || amountMinor === null) return;

    saving = true;
    submitError = '';
    try {
      await onsave({ amountMinor, paidOn, note });
    } catch (cause) {
      submitError = cause instanceof Error ? cause.message : 'The payment could not be recorded.';
    } finally {
      saving = false;
    }
  }
</script>

<form
  class="pay-later-form"
  aria-label={`Record payment to ${plan.name}`}
  novalidate
  onsubmit={submit}
>
  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="pay-later-payment-amount">Amount ({currencySymbol(currency)})</label>
      <input
        id="pay-later-payment-amount"
        type="text"
        inputmode="decimal"
        bind:value={amount}
        aria-invalid={errors.amount ? 'true' : undefined}
        aria-describedby={errors.amount ? 'pay-later-payment-amount-error' : undefined}
      />
      {#if errors.amount}
        <p class="field-error" id="pay-later-payment-amount-error">{errors.amount}</p>
      {/if}
    </div>
    <div class="field-group">
      <label for="pay-later-payment-date">Payment date</label>
      <input
        id="pay-later-payment-date"
        type="date"
        bind:value={paidOn}
        aria-invalid={errors.paidOn ? 'true' : undefined}
        aria-describedby={errors.paidOn ? 'pay-later-payment-date-error' : undefined}
      />
      {#if errors.paidOn}
        <p class="field-error" id="pay-later-payment-date-error">{errors.paidOn}</p>
      {/if}
    </div>
  </div>
  <div class="field-group">
    <label for="pay-later-payment-note">Note <span class="optional">Optional</span></label>
    <textarea id="pay-later-payment-note" bind:value={note} maxlength="2000"></textarea>
    {#if errors.note}<p class="field-error">{errors.note}</p>{/if}
  </div>
  {#if submitError}<p class="form-error" role="alert">{submitError}</p>{/if}
  <div class="form-actions">
    <button class="button secondary" type="button" onclick={oncancel}>
      <X size={17} aria-hidden="true" /> Cancel
    </button>
    <button class="button primary" type="submit" disabled={saving}>
      <Save size={17} aria-hidden="true" />
      {saving ? 'Recording…' : 'Record payment'}
    </button>
  </div>
</form>
