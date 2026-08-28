<script lang="ts">
  import { resolve } from '$app/paths';
  import { Database, FileLock2, ShieldCheck, Trash2 } from '@lucide/svelte';
</script>

<svelte:head>
  <title>Privacy | Debt Tracker</title>
</svelte:head>

<div class="page-stack settings-page">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Private by design</p>
      <h1>Your data stays under your control.</h1>
      <p>Debt Tracker calculates and stores your plan locally. There is no account or backend.</p>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <Database size={21} aria-hidden="true" />
      <div>
        <h2>What is stored</h2>
        <p>Debts, balances, payments, settings, and saved plan snapshots.</p>
      </div>
    </div>
    <div class="backup-panel">
      <p>
        Supported browsers store this information in IndexedDB on this device. If browser storage is
        unavailable, the app switches to a clearly marked in-memory session that disappears when the
        tab closes.
      </p>
      <p>
        The app has no analytics, advertising, telemetry, third-party runtime assets, or server-side
        financial records.
      </p>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <FileLock2 size={21} aria-hidden="true" />
      <div>
        <h2>Backups are your responsibility</h2>
        <p>Export a copy before clearing data, changing browsers, or changing devices.</p>
      </div>
    </div>
    <div class="backup-panel">
      <p>
        Plain backups contain readable financial data. Encrypted backups use AES-256-GCM with a key
        derived from your passphrase. The passphrase is never stored and cannot be recovered.
      </p>
      <a class="button primary" href={resolve('/settings')}>Create or restore a backup</a>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <Trash2 size={21} aria-hidden="true" />
      <div>
        <h2>Deleting browser data</h2>
        <p>Browser controls can permanently remove the local database.</p>
      </div>
    </div>
    <div class="backup-panel">
      <p>
        Clearing site data, using some private-browsing modes, or uninstalling the browser can
        remove your plan. Debt Tracker cannot restore deleted data unless you kept a backup.
      </p>
    </div>
  </section>

  <section class="settings-privacy">
    <ShieldCheck size={18} aria-hidden="true" />
    <p>
      <strong>Planning estimates only.</strong> Results are not financial advice. Lenders may calculate
      interest, fees, and payment timing differently.
    </p>
  </section>
</div>
