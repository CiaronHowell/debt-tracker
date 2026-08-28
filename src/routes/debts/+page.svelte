<script lang="ts">
  import { Plus, WalletCards } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Debts | Debt Tracker</title>
</svelte:head>

<div class="page-stack">
  <section class="page-heading heading-row">
    <div>
      <p class="eyebrow">Your balances</p>
      <h1>Debts</h1>
      <p>Add the balances and minimums that will shape your payoff plan.</p>
    </div>
    <button class="button primary" type="button" disabled title="Available in Milestone 4">
      <Plus size={18} aria-hidden="true" />
      Add debt
    </button>
  </section>

  <section class="empty-state">
    <span class="empty-icon"><WalletCards size={30} strokeWidth={1.6} aria-hidden="true" /></span>
    <h2>No debts added yet</h2>
    <p>Add your first debt to begin building a snowball plan.</p>
    <span class="scaffold-note">Debt entry arrives in Milestone 4.</span>
  </section>
</div>
