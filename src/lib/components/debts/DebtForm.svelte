<script lang="ts">
  import { Save, X } from '@lucide/svelte';
  import type { Currency } from '$lib/domain';
  import type { Debt, DebtType } from '$lib/persistence';
  import { currentLocalDate, formatCalendarDate } from '$lib/utils/dates';
  import {
    currencySymbol,
    formatMoneyInput,
    parseAprInput,
    parseMoneyInput
  } from '$lib/utils/money';

  export interface DebtFormSubmission {
    name: string;
    type: DebtType;
    balanceMinor: number;
    balanceAsOf: string;
    aprBasisPoints: number | null;
    promotionalAprEndsOn: string | null;
    minimumPaymentMinor: number;
    dueDay: number | null;
    notes: string;
    colorKey: null;
  }

  interface Props {
    debt?: Debt | null;
    currency: Currency;
    onsave: (value: DebtFormSubmission) => Promise<void>;
    oncancel?: () => void;
  }

  let { debt = null, currency, onsave, oncancel }: Props = $props();

  function initialState(value: Debt | null) {
    return {
      name: value?.name ?? '',
      type: value?.type ?? ('credit-card' as DebtType),
      balance: value ? formatMoneyInput(value.currentBalanceMinor) : '',
      balanceAsOf: value?.balanceAsOf ?? currentLocalDate(),
      apr: value?.aprBasisPoints == null ? '' : formatMoneyInput(value.aprBasisPoints),
      promotionalAprEndsOn: value?.promotionalAprEndsOn ?? '',
      promotional: value?.promotionalAprEndsOn != null,
      minimumPayment: value ? formatMoneyInput(value.minimumPaymentMinor) : '',
      dueDay: value?.dueDay == null ? '' : String(value.dueDay),
      notes: value?.notes ?? ''
    };
  }

  // This component is keyed by debt id, so props intentionally seed a fresh form instance.
  // svelte-ignore state_referenced_locally
  const initial = initialState(debt);
  let name = $state(initial.name);
  let type = $state<DebtType>(initial.type);
  let balance = $state(initial.balance);
  let balanceAsOf = $state(initial.balanceAsOf);
  let apr = $state(initial.apr);
  let promotional = $state(initial.promotional);
  let promotionalAprEndsOn = $state(initial.promotionalAprEndsOn);
  let minimumPayment = $state(initial.minimumPayment);
  let dueDay = $state(initial.dueDay);
  let notes = $state(initial.notes);
  let errors = $state<Record<string, string>>({});
  let submitError = $state('');
  let saving = $state(false);

  function supportsPromotion(value: DebtType = type): boolean {
    return value === 'credit-card' || value === 'balance-transfer';
  }

  function changeType(event: Event): void {
    const nextType = (event.currentTarget as HTMLSelectElement).value as DebtType;
    const previousType = type;
    type = nextType;
    if (nextType === 'balance-transfer' && previousType !== 'balance-transfer') {
      promotional = true;
    } else if (!supportsPromotion(nextType)) {
      promotional = false;
    }
  }

  function validate(): DebtFormSubmission | null {
    const nextErrors: Record<string, string> = {};
    const trimmedName = name.trim();
    const balanceMinor = parseMoneyInput(balance);
    const minimumPaymentMinor = parseMoneyInput(minimumPayment);
    const aprBasisPoints = apr.trim() === '' ? null : parseAprInput(apr);
    const promotionEnabled = promotional && supportsPromotion();
    const promotionEndDate = promotionEnabled ? promotionalAprEndsOn : null;
    const dueDayValue = String(dueDay).trim();
    const parsedDueDay = dueDayValue === '' ? null : Number(dueDayValue);

    if (!trimmedName || trimmedName.length > 80) {
      nextErrors.name = 'Enter a name between 1 and 80 characters.';
    }
    if (balanceMinor === null || balanceMinor <= 0) {
      nextErrors.balance = 'Enter a balance greater than 0 with up to two decimal places.';
    }
    if (!balanceAsOf) nextErrors.balanceAsOf = 'Choose the date this balance was recorded.';
    if (apr.trim() !== '' && aprBasisPoints === null) {
      nextErrors.apr = 'Enter an APR from 0 to 1,000 with up to two decimal places.';
    }
    if (promotionEnabled && !promotionEndDate) {
      nextErrors.promotionalAprEndsOn = 'Choose the date the 0% promotion ends.';
    }
    if (minimumPaymentMinor === null || minimumPaymentMinor <= 0) {
      nextErrors.minimumPayment =
        'Enter a minimum payment greater than 0 with up to two decimal places.';
    }
    if (
      parsedDueDay !== null &&
      (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 31)
    ) {
      nextErrors.dueDay = 'Enter a whole day from 1 to 31, or leave it blank.';
    }
    if (notes.length > 2_000) nextErrors.notes = 'Notes must be 2,000 characters or fewer.';

    errors = nextErrors;
    if (Object.keys(nextErrors).length || balanceMinor === null || minimumPaymentMinor === null) {
      return null;
    }

    return {
      name: trimmedName,
      type,
      balanceMinor,
      balanceAsOf,
      aprBasisPoints,
      promotionalAprEndsOn: promotionEndDate,
      minimumPaymentMinor,
      dueDay: parsedDueDay,
      notes,
      colorKey: null
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
    } catch (error) {
      submitError = error instanceof Error ? error.message : 'The debt could not be saved.';
    } finally {
      saving = false;
    }
  }
</script>

<form class="debt-form" novalidate onsubmit={submit}>
  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="debt-name">Debt name</label>
      <input
        id="debt-name"
        name="name"
        bind:value={name}
        maxlength="80"
        autocomplete="off"
        aria-invalid={errors.name ? 'true' : undefined}
        aria-describedby={errors.name ? 'debt-name-error' : undefined}
      />
      {#if errors.name}<p class="field-error" id="debt-name-error">{errors.name}</p>{/if}
    </div>

    <div class="field-group">
      <label for="debt-type">Debt type</label>
      <select id="debt-type" name="type" value={type} onchange={changeType}>
        <option value="credit-card">Credit card</option>
        <option value="balance-transfer">Balance transfer</option>
        <option value="loan">Loan</option>
        <option value="overdraft">Overdraft</option>
        <option value="other">Other</option>
      </select>
    </div>
  </div>

  <div class="form-grid two-columns">
    <div class="field-group">
      <label for="debt-balance">Current balance ({currencySymbol(currency)})</label>
      <input
        id="debt-balance"
        name="balance"
        type="text"
        inputmode="decimal"
        placeholder="0.00"
        bind:value={balance}
        aria-invalid={errors.balance ? 'true' : undefined}
        aria-describedby={errors.balance ? 'debt-balance-error' : 'debt-balance-hint'}
      />
      <p class="field-hint" id="debt-balance-hint">Use the latest balance you know.</p>
      {#if errors.balance}<p class="field-error" id="debt-balance-error">{errors.balance}</p>{/if}
    </div>

    <div class="field-group">
      <label for="balance-date">Balance as of</label>
      <input
        id="balance-date"
        name="balanceAsOf"
        type="date"
        bind:value={balanceAsOf}
        aria-invalid={errors.balanceAsOf ? 'true' : undefined}
        aria-describedby={errors.balanceAsOf ? 'balance-date-error' : undefined}
      />
      {#if errors.balanceAsOf}
        <p class="field-error" id="balance-date-error">{errors.balanceAsOf}</p>
      {/if}
    </div>
  </div>

  {#if supportsPromotion()}
    <div class="promotion-card">
      <label class="promotion-toggle" for="zero-percent-promotion">
        <span>
          <strong>Currently on a 0% promotion</strong>
          <small>Interest starts after the promotion expiry date.</small>
        </span>
        <input
          id="zero-percent-promotion"
          name="promotional"
          type="checkbox"
          role="switch"
          bind:checked={promotional}
        />
      </label>

      {#if promotional}
        <div class="form-grid two-columns promotion-fields">
          <div class="field-group">
            <label for="promotion-end-date">0% ends</label>
            <input
              id="promotion-end-date"
              name="promotionalAprEndsOn"
              type="date"
              bind:value={promotionalAprEndsOn}
              aria-invalid={errors.promotionalAprEndsOn ? 'true' : undefined}
              aria-describedby={errors.promotionalAprEndsOn
                ? 'promotion-end-date-error'
                : undefined}
            />
            {#if errors.promotionalAprEndsOn}
              <p class="field-error" id="promotion-end-date-error">
                {errors.promotionalAprEndsOn}
              </p>
            {/if}
          </div>

          <div class="field-group">
            <label for="debt-apr"
              >APR after promotion (%) <span class="optional">Optional</span></label
            >
            <input
              id="debt-apr"
              name="apr"
              type="text"
              inputmode="decimal"
              placeholder="19.99"
              bind:value={apr}
              aria-invalid={errors.apr ? 'true' : undefined}
              aria-describedby={errors.apr ? 'debt-apr-error' : 'debt-apr-hint'}
            />
            <p class="field-hint" id="debt-apr-hint">Leave blank if you do not know it.</p>
            {#if errors.apr}<p class="field-error" id="debt-apr-error">{errors.apr}</p>{/if}
          </div>
        </div>
        <p class="promotion-summary">
          {#if promotionalAprEndsOn}
            We'll use 0% through {formatCalendarDate(promotionalAprEndsOn)}, then {apr.trim()
              ? `${apr.trim()}% APR`
              : 'the APR you add later'}.
          {:else}
            Add the expiry date so the plan knows when interest starts.
          {/if}
        </p>
      {/if}
    </div>
  {/if}

  {#if !promotional || !supportsPromotion()}
    <div class="form-grid three-columns">
      <div class="field-group">
        <label for="debt-apr">APR (%) <span class="optional">Optional</span></label>
        <input
          id="debt-apr"
          name="apr"
          type="text"
          inputmode="decimal"
          placeholder="19.99"
          bind:value={apr}
          aria-invalid={errors.apr ? 'true' : undefined}
          aria-describedby={errors.apr ? 'debt-apr-error' : 'debt-apr-hint'}
        />
        <p class="field-hint" id="debt-apr-hint">Leave blank if you do not know it.</p>
        {#if errors.apr}<p class="field-error" id="debt-apr-error">{errors.apr}</p>{/if}
      </div>

      <div class="field-group">
        <label for="minimum-payment">Minimum payment ({currencySymbol(currency)})</label>
        <input
          id="minimum-payment"
          name="minimumPayment"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          bind:value={minimumPayment}
          aria-invalid={errors.minimumPayment ? 'true' : undefined}
          aria-describedby={errors.minimumPayment ? 'minimum-payment-error' : undefined}
        />
        {#if errors.minimumPayment}
          <p class="field-error" id="minimum-payment-error">{errors.minimumPayment}</p>
        {/if}
      </div>

      <div class="field-group">
        <label for="due-day">Due day <span class="optional">Optional</span></label>
        <input
          id="due-day"
          name="dueDay"
          type="number"
          inputmode="numeric"
          min="1"
          max="31"
          placeholder="15"
          bind:value={dueDay}
          aria-invalid={errors.dueDay ? 'true' : undefined}
          aria-describedby={errors.dueDay ? 'due-day-error' : undefined}
        />
        {#if errors.dueDay}<p class="field-error" id="due-day-error">{errors.dueDay}</p>{/if}
      </div>
    </div>
  {:else}
    <div class="form-grid two-columns">
      <div class="field-group">
        <label for="minimum-payment">Minimum payment ({currencySymbol(currency)})</label>
        <input
          id="minimum-payment"
          name="minimumPayment"
          type="text"
          inputmode="decimal"
          placeholder="0.00"
          bind:value={minimumPayment}
          aria-invalid={errors.minimumPayment ? 'true' : undefined}
          aria-describedby={errors.minimumPayment ? 'minimum-payment-error' : undefined}
        />
        {#if errors.minimumPayment}
          <p class="field-error" id="minimum-payment-error">{errors.minimumPayment}</p>
        {/if}
      </div>

      <div class="field-group">
        <label for="due-day">Due day <span class="optional">Optional</span></label>
        <input
          id="due-day"
          name="dueDay"
          type="number"
          inputmode="numeric"
          min="1"
          max="31"
          placeholder="15"
          bind:value={dueDay}
          aria-invalid={errors.dueDay ? 'true' : undefined}
          aria-describedby={errors.dueDay ? 'due-day-error' : undefined}
        />
        {#if errors.dueDay}<p class="field-error" id="due-day-error">{errors.dueDay}</p>{/if}
      </div>
    </div>
  {/if}

  <div class="field-group">
    <label for="debt-notes">Notes <span class="optional">Optional</span></label>
    <textarea
      id="debt-notes"
      name="notes"
      rows="3"
      maxlength="2000"
      bind:value={notes}
      aria-invalid={errors.notes ? 'true' : undefined}
      aria-describedby={errors.notes ? 'debt-notes-error' : undefined}></textarea>
    {#if errors.notes}<p class="field-error" id="debt-notes-error">{errors.notes}</p>{/if}
  </div>

  {#if submitError}<p class="form-error" role="alert">{submitError}</p>{/if}

  <div class="form-actions">
    {#if oncancel}
      <button class="button secondary" type="button" onclick={oncancel} disabled={saving}>
        <X size={17} aria-hidden="true" /> Cancel
      </button>
    {/if}
    <button class="button primary" type="submit" disabled={saving}>
      <Save size={17} aria-hidden="true" />
      {saving ? 'Saving…' : debt ? 'Save changes' : 'Save debt'}
    </button>
  </div>
</form>
