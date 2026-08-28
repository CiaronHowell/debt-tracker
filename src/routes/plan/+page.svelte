<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowRight, Flag, Route, Sparkles } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Plan | Debt Tracker</title>
</svelte:head>

<div class="page-stack">
  <section class="page-heading heading-row">
    <div>
      <p class="eyebrow">Your route to debt-free</p>
      <h1>Plan</h1>
      <p>See when each debt clears and how your snowball grows.</p>
    </div>
  </section>

  <section class="timeline-shell" aria-labelledby="plan-empty-title">
    <div class="timeline-line" aria-hidden="true">
      <span class="timeline-dot active"></span>
      <span class="timeline-stem"></span>
      <span class="timeline-dot"></span>
      <span class="timeline-stem"></span>
      <span class="timeline-dot success"></span>
    </div>
    <div class="timeline-content">
      <div>
        <Route size={20} aria-hidden="true" />
        <p>Start here</p>
        <h2 id="plan-empty-title">Build your first plan</h2>
        <span>Your lowest balance becomes the first target.</span>
      </div>
      <div class="muted-milestone">
        <Sparkles size={20} aria-hidden="true" />
        <p>Snowball grows</p>
        <span>Each cleared minimum rolls into the next debt.</span>
      </div>
      <div class="muted-milestone">
        <Flag size={20} aria-hidden="true" />
        <p>Debt-free</p>
        <span>Your projected finish line will appear here.</span>
      </div>
    </div>
    <a class="button primary timeline-action" href={resolve('/setup')}
      >Start setup <ArrowRight size={18} aria-hidden="true" /></a
    >
  </section>
</div>
