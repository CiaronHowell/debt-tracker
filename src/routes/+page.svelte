<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, CheckCircle2, LockKeyhole, Target } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Home | Debt Tracker</title>
</svelte:head>

<div class="page-stack">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Your debt-free plan</p>
      <h1>Know exactly what to pay next.</h1>
      <p>Build a private debt snowball plan and track every step from this device.</p>
    </div>
  </section>

  <section class="action-card empty-action" aria-labelledby="empty-plan-title">
    <div class="action-icon"><Target size={28} strokeWidth={1.8} aria-hidden="true" /></div>
    <div class="action-copy">
      <p class="card-label">Your next payment</p>
      <h2 id="empty-plan-title">Add your first debt to build a payoff plan</h2>
      <p>
        Enter your balances, interest rates, and minimum payments. We’ll calculate the order and
        show your first action.
      </p>
    </div>
    <a class="button primary" href={resolve('/setup')}>
      Build my plan
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  </section>

  <section class="metric-grid" aria-label="What your plan will show">
    <article class="metric-card">
      <span class="metric-icon"><Target size={19} aria-hidden="true" /></span>
      <p>Next target</p>
      <strong>One clear payment</strong>
      <span>See the amount and debt to tackle now.</span>
    </article>
    <article class="metric-card">
      <span class="metric-icon"><CheckCircle2 size={19} aria-hidden="true" /></span>
      <p>Debt-free date</p>
      <strong>Your finish line</strong>
      <span>Understand how each extra payment helps.</span>
    </article>
    <article class="metric-card">
      <span class="metric-icon"><LockKeyhole size={19} aria-hidden="true" /></span>
      <p>Private by default</p>
      <strong>Stored locally</strong>
      <span>No account, analytics, or bank connection.</span>
    </article>
  </section>

  <section class="notice-card">
    <LockKeyhole size={20} aria-hidden="true" />
    <div>
      <h2>Your data stays here</h2>
      <p>
        Debt Tracker stores your plan in this browser. You’ll be able to create a protected backup
        from Settings.
      </p>
    </div>
  </section>
</div>
