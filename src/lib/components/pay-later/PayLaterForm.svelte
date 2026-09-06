<script lang="ts">
  import { Save, X } from '@lucide/svelte';
  import type { Currency } from '$lib/domain';
  import type { PayLaterPlan } from '$lib/persistence';
  import { currentLocalDate } from '$lib/utils/dates';
  import {
    currencySymbol,
    formatMoneyInput,
    parseAprInput,
    parseMoneyInput
  } from '$lib/utils/money';

  export interface PayLaterFormSubmission {
    name: string;
    balanceMinor: number;
    purchaseDate: string;
    deadlineDate: string;
    missedDeadlineAprBasisPoints: number | null;
    notes: string;
  }

  interface Props {
    plan?: PayLaterPlan | null;
    currency: Currency;
    onsave: (value: PayLaterFormSubmission) => Promise<void>;
    oncancel: () => void;
  }

  let { plan = null, currency, onsave, oncancel }: Props = $props();

  function initialState(value: PayLaterPlan | null) {
    return {
      name: value?.name ?? '',
      balance: value ? formatMoneyInput(value.currentBalanceMinor) : '',
      purchaseDate: value?.purchaseDate ?? currentLocalDate(),
      deadlineDate: value?.deadlineDate ?? '',
      missedDeadlineApr:
        value?.missedDeadlineAprBasisPoints == null
          ? ''
          : formatMoneyInput(value.missedDeadlineAprBasisPoints),
      notes: value?.notes ?? ''
    };
  }

  // This component is keyed by plan id, so props intentionally seed a fresh form instance.
  // svelte-ignore state_referenced_locally
  const initial = initialState(plan);
  let name = $state(initial.name);
  let balance = $state(initial.balance);
  let purchaseDate = $state(initial.purchaseDate);
  let deadlineDate = $state(initial.deadlineDate);
  let missedDeadlineApr = $state(initial.missedDeadlineApr);
  let notes = $state(initial.notes);
  let errors = $state<Record<string, string>>({});
  let submitError = $state('');
  let saving = $state(false);

  function validate(): PayLaterFormSubmission | null {
    const nextErrors: Record<string, string> = {};
    const trimmedName = name.trim();
    const balanceMinor = parseMoneyInput(balance);
    const aprBasisPoints =
      missedDeadlineApr.trim() === '' ? null : parseAprInput(missedDeadlineApr);

    if (!trimmedName || trimmedName.length > 80) {
      nextErrors.name = 'Enter a name between 1 and 80 characters.';
    }
    if (balanceMinor === null || balanceMinor < 0 || (!plan && balanceMinor === 0)) {
      nextErrors.balance = plan
        ? 'Enter a balance of 0 or more with up to two decimal places.'
        : 'Enter a balance greater than 0 with up to two decimal places.';
    }
    if (!purchaseDate) nextErrors.purchaseDate = 'Choose the purchase or plan start date.';
    if (!deadlineDate) nextErrors.deadlineDate = 'Choose the date the balance must be cleared.';
    if (purchaseDate && deadlineDate && deadlineDate < purchaseDate) {
      nextErrors.deadlineDate = 'Choose a deadline on or after the purchase date.';
    }
    if (missedDeadlineApr.trim() !== '' && aprBasisPoints === null) {
      nextErrors.missedDeadlineApr =
        'Enter a yearly interest rate from 0 to 1,000 with up to two decimal places.';
    }
    if (notes.length > 2_000) nextErrors.notes = 'Notes must be 2,000 characters or fewer.';

    errors = nextErrors;
    if (Object.keys(nextErrors).length || balanceMinor === null) return null;
    return {
      name: trimmedName,
      balanceMinor,
      purchaseDate,
      deadlineDate,
      missedDeadlineAprBasisPoints: aprBasisPoints,
      notes
    };
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    submitError = '';
    const value = validate();
    if (!value) return;
    saving = true;
    try {
      await onsave(value);
    } catch (cause) {
      submitError =
        cause instanceof Error ? cause.message : 'The pay-later plan could not be saved.';
    } finally {
      saving = false;
    }
  }
</script>

<form class="pay-later-form" novalidate onsubmit={submit}>
  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="pay-later-name">Purchase or plan name</label>
      <input
        id="pay-later-name"
        bind:value={name}
        maxlength="80"
        autocomplete="off"
        placeholder="Argos furniture"
        aria-invalid={errors.name ? 'true' : undefined}
        aria-describedby={errors.name ? 'pay-later-name-error' : undefined}
      />
      {#if errors.name}<p class="field-error" id="pay-later-name-error">{errors.name}</p>{/if}
    </div>
    <div class="field-group">
      <label for="pay-later-balance"
        >{plan ? 'Current balance' : 'Starting balance'} ({currencySymbol(currency)})</label
      >
      <input
        id="pay-later-balance"
        type="text"
        inputmode="decimal"
        bind:value={balance}
        placeholder="0.00"
        aria-invalid={errors.balance ? 'true' : undefined}
        aria-describedby={errors.balance ? 'pay-later-balance-error' : undefined}
      />
      {#if errors.balance}
        <p class="field-error" id="pay-later-balance-error">{errors.balance}</p>
      {/if}
    </div>
  </div>

  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="pay-later-purchase-date">Purchase or plan start</label>
      <input
        id="pay-later-purchase-date"
        type="date"
        bind:value={purchaseDate}
        aria-invalid={errors.purchaseDate ? 'true' : undefined}
        aria-describedby={errors.purchaseDate ? 'pay-later-purchase-date-error' : undefined}
      />
      {#if errors.purchaseDate}
        <p class="field-error" id="pay-later-purchase-date-error">{errors.purchaseDate}</p>
      {/if}
    </div>
    <div class="field-group">
      <label for="pay-later-deadline">Pay in full by</label>
      <input
        id="pay-later-deadline"
        type="date"
        bind:value={deadlineDate}
        aria-invalid={errors.deadlineDate ? 'true' : undefined}
        aria-describedby={errors.deadlineDate ? 'pay-later-deadline-error' : 'deadline-hint'}
      />
      <p class="field-hint" id="deadline-hint">The monthly target is calculated from this date.</p>
      {#if errors.deadlineDate}
        <p class="field-error" id="pay-later-deadline-error">{errors.deadlineDate}</p>
      {/if}
    </div>
  </div>

  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="missed-deadline-apr"
        >Interest rate if the deadline is missed (%) <span class="optional">Optional</span></label
      >
      <input
        id="missed-deadline-apr"
        type="text"
        inputmode="decimal"
        bind:value={missedDeadlineApr}
        placeholder="34.90"
        aria-invalid={errors.missedDeadlineApr ? 'true' : undefined}
        aria-describedby={errors.missedDeadlineApr ? 'missed-deadline-apr-error' : 'apr-hint'}
      />
      <p class="field-hint" id="apr-hint">
        This is the provider’s annual percentage rate (APR). It is used for warnings only; your
        agreement decides how interest is charged.
      </p>
      {#if errors.missedDeadlineApr}
        <p class="field-error" id="missed-deadline-apr-error">{errors.missedDeadlineApr}</p>
      {/if}
    </div>
    <div class="field-group">
      <label for="pay-later-notes">Notes <span class="optional">Optional</span></label>
      <textarea id="pay-later-notes" bind:value={notes} maxlength="2000"></textarea>
      {#if errors.notes}<p class="field-error">{errors.notes}</p>{/if}
    </div>
  </div>

  {#if submitError}<p class="form-error" role="alert">{submitError}</p>{/if}
  <div class="form-actions">
    <button class="button secondary" type="button" onclick={oncancel}>
      <X size={17} aria-hidden="true" /> Cancel
    </button>
    <button class="button primary" type="submit" disabled={saving}>
      <Save size={17} aria-hidden="true" />
      {saving ? 'Saving…' : 'Save pay-later plan'}
    </button>
  </div>
</form>
