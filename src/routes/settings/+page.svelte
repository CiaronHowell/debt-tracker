<script lang="ts">
  import { Database, Download, LockKeyhole, ShieldCheck } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Settings | Debt Tracker</title>
</svelte:head>

<div class="page-stack settings-page">
  <section class="page-heading">
    <p class="eyebrow">Preferences and privacy</p>
    <h1>Settings</h1>
    <p>Manage how your local plan is stored and protected.</p>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <Database size={21} aria-hidden="true" />
      <div>
        <h2>Local data</h2>
        <p>Your plan is stored only in this browser.</p>
      </div>
    </div>
    <div class="settings-row">
      <div><strong>Storage status</strong><span>No plan created yet</span></div>
      <span class="status-pill"><ShieldCheck size={15} aria-hidden="true" /> Available</span>
    </div>
    <div class="settings-row">
      <div><strong>Currency</strong><span>Formatting only — no conversion</span></div>
      <span class="value-pill">GBP (£)</span>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <LockKeyhole size={21} aria-hidden="true" />
      <div>
        <h2>Backup</h2>
        <p>Keep a recoverable copy outside this browser.</p>
      </div>
    </div>
    <div class="backup-actions">
      <button class="button secondary" type="button" disabled title="Available in Milestone 3">
        <Download size={17} aria-hidden="true" /> Export backup
      </button>
      <span class="scaffold-note">Encrypted backup and restore arrive in Milestone 3.</span>
    </div>
  </section>
</div>
