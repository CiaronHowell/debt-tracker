<script lang="ts">
  import { AlertTriangle, CheckCircle2, ShieldCheck } from '@lucide/svelte';
  import type { Currency, PayoffAlgorithm, PromotionImpact } from '$lib/domain';
  import { formatCalendarDate } from '$lib/utils/dates';
  import { formatMoney } from '$lib/utils/money';

  let {
    impacts,
    currency,
    algorithm,
    disabled = false,
    onalgorithmchange
  }: {
    impacts: PromotionImpact[];
    currency: Currency;
    algorithm: PayoffAlgorithm;
    disabled?: boolean;
    onalgorithmchange: (algorithm: PayoffAlgorithm) => void;
  } = $props();

  function formatApr(basisPoints: number | null): string {
    return basisPoints === null ? 'an unknown APR' : `${(basisPoints / 100).toFixed(2)}% APR`;
  }

  function toggleAlgorithm(): void {
    onalgorithmchange(algorithm === 'deadline-aware' ? 'snowball' : 'deadline-aware');
  }
</script>

<section class="promotion-impact-panel" aria-labelledby="promotion-impact-title">
  <div class="promotion-impact-heading">
    <div>
      <p class="eyebrow">0% deadline</p>
      <h2 id="promotion-impact-title">Protect your promotional rates</h2>
    </div>
    <ShieldCheck size={22} aria-hidden="true" />
  </div>

  <div class="promotion-impact-list">
    {#each impacts as impact (impact.debtId)}
      <article class:at-risk={impact.atRisk} class="promotion-impact-card">
        <div class="promotion-impact-title-row">
          <div>
            <h3>{impact.name} 0% ends {formatCalendarDate(impact.promotionalAprEndsOn)}</h3>
            {#if impact.atRisk}
              <p>
                At your current pace, about {formatMoney(impact.balanceAtExpiryMinor, currency)} may still
                be owed. At {formatApr(impact.postPromotionAprBasisPoints)}, that could add
                {impact.firstFullMonthInterestMinor === null
                  ? ' an unknown amount of interest'
                  : ` about ${formatMoney(impact.firstFullMonthInterestMinor, currency)} interest`}
                in the first full month afterward.
              </p>
            {:else}
              <p>This plan clears the balance before post-promotion interest starts.</p>
            {/if}
          </div>
          <span class:clear={!impact.atRisk} class="promotion-impact-status">
            {#if impact.atRisk}
              <AlertTriangle size={14} aria-hidden="true" />
              {impact.paymentMonthsRemaining === 0
                ? 'No payments before deadline'
                : impact.paymentMonthsRemaining === 1
                  ? '1 payment left'
                  : `${impact.paymentMonthsRemaining} payments left`}
            {:else}
              <CheckCircle2 size={14} aria-hidden="true" /> On track
            {/if}
          </span>
        </div>

        {#if impact.atRisk}
          <dl class="promotion-impact-metrics">
            <div>
              <dt>{impact.paymentMonthsRemaining ? 'Clear it in time' : 'Needed before expiry'}</dt>
              <dd>
                {formatMoney(
                  impact.requiredMonthlyPaymentMinor,
                  currency
                )}{impact.paymentMonthsRemaining ? '/month' : ''}
              </dd>
            </div>
            <div>
              <dt>{impact.paymentMonthsRemaining ? 'Payment shortfall' : 'Amount still needed'}</dt>
              <dd class:warning={impact.monthlyPaymentShortfallMinor > 0}>
                {impact.monthlyPaymentShortfallMinor > 0
                  ? `${formatMoney(impact.monthlyPaymentShortfallMinor, currency)}${impact.paymentMonthsRemaining ? '/month' : ''}`
                  : 'No shortfall'}
              </dd>
            </div>
          </dl>
        {/if}
      </article>
    {/each}
  </div>

  <div class="deadline-strategy-control">
    <div>
      <strong>Protect 0% offers</strong>
      <span>Send extra payments to at-risk promotions by earliest expiry, then highest APR.</span>
    </div>
    <button
      type="button"
      class="strategy-switch"
      role="switch"
      aria-checked={algorithm === 'deadline-aware'}
      aria-label="Protect 0% offers"
      {disabled}
      onclick={toggleAlgorithm}
    >
      <span aria-hidden="true"></span>
    </button>
  </div>
  <p class="promotion-impact-note">
    Minimum payments still go to every debt. This changes only where extra money goes.
  </p>
</section>
