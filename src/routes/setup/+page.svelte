<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Check, Database, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Set up your plan | Debt Tracker</title>
</svelte:head>

<div class="narrow-page page-stack">
  <ol class="setup-progress" aria-label="Setup progress">
    <li class="current"><span>1</span><strong>Privacy</strong></li>
    <li><span>2</span><strong>Debts</strong></li>
    <li><span>3</span><strong>Budget</strong></li>
    <li><span>4</span><strong>Review</strong></li>
  </ol>

  <section class="setup-card">
    <div class="setup-illustration">
      <ShieldCheck size={34} strokeWidth={1.6} aria-hidden="true" />
    </div>
    <p class="eyebrow">Before we begin</p>
    <h1>Your plan stays on this device.</h1>
    <p class="lead">
      There is no account and nothing is sent to a server. Your debts and payment history are stored
      privately in this browser.
    </p>

    <ul class="feature-list">
      <li>
        <Check size={18} aria-hidden="true" /><span>All calculations happen in your browser</span>
      </li>
      <li>
        <Database size={18} aria-hidden="true" /><span
          >Your progress saves automatically on this device</span
        >
      </li>
      <li>
        <ShieldCheck size={18} aria-hidden="true" /><span
          >You can create an encrypted backup at any time</span
        >
      </li>
    </ul>

    <div class="warning-note">
      Clearing browser data can remove your plan. We’ll remind you to create a backup after setup.
    </div>

    <a class="button primary full-width" href={resolve('/debts')}>
      Add my debts
      <ArrowRight size={18} aria-hidden="true" />
    </a>
  </section>
</div>
