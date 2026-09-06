<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import {
    AlertTriangle,
    Database,
    Download,
    FileJson,
    FileUp,
    LockKeyhole,
    ShieldCheck
  } from '@lucide/svelte';
  import { BackupService, PlanService, type BackupPreview } from '$lib/application';
  import {
    getDatabase,
    getPersistenceMode,
    type PersistenceMode,
    type PlanSettings
  } from '$lib/persistence';
  import { formatCalendarDate } from '$lib/utils/dates';

  const database = getDatabase();
  const backups = new BackupService(database);
  const plans = new PlanService(database);

  let loading = $state(true);
  let settings = $state<PlanSettings | undefined>();
  let storageMode = $state<PersistenceMode>(getPersistenceMode());
  let exporting = $state<'plain' | 'encrypted' | null>(null);
  let showEncryptedExport = $state(false);
  let exportPassphrase = $state('');
  let exportPassphraseConfirmation = $state('');
  let selectedFileName = $state('');
  let selectedBackup = $state('');
  let selectedBackupEncrypted = $state(false);
  let importPassphrase = $state('');
  let preview = $state<BackupPreview | null>(null);
  let importing = $state(false);
  let errorMessage = $state('');
  let successMessage = $state('');

  onMount(async () => {
    try {
      const recovered = await backups.recoverInterruptedImport();
      settings = await plans.getSettings();
      storageMode = getPersistenceMode();
      if (recovered) successMessage = 'An interrupted restore was safely rolled back.';
    } catch (error) {
      errorMessage = messageFor(error, 'Storage status could not be checked.');
    } finally {
      loading = false;
    }
  });

  function messageFor(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  function backupFileName(encrypted: boolean, exportedAt: string): string {
    const timestamp = exportedAt.replace(/[:.]/g, '-');
    return `debt-tracker-${timestamp}.${encrypted ? 'debt-plan.enc.json' : 'debt-plan.json'}`;
  }

  function downloadBackup(contents: string, fileName: string): void {
    const url = URL.createObjectURL(
      new Blob([contents], { type: 'application/json;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportPlain(): Promise<void> {
    exporting = 'plain';
    errorMessage = '';
    successMessage = '';
    try {
      const envelope = await backups.exportPlain();
      downloadBackup(backups.serialize(envelope), backupFileName(false, envelope.exportedAt));
      successMessage = 'Plain backup downloaded. Store it somewhere private.';
    } catch (error) {
      errorMessage = messageFor(error, 'The backup could not be created.');
    } finally {
      exporting = null;
    }
  }

  async function exportEncrypted(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorMessage = '';
    successMessage = '';
    if (!exportPassphrase) {
      errorMessage = 'Enter a passphrase for the encrypted backup.';
      return;
    }
    if (exportPassphrase !== exportPassphraseConfirmation) {
      errorMessage = 'The backup passphrases do not match.';
      return;
    }

    exporting = 'encrypted';
    try {
      const envelope = await backups.exportEncrypted(exportPassphrase);
      downloadBackup(backups.serialize(envelope), backupFileName(true, envelope.exportedAt));
      successMessage = 'Encrypted backup downloaded. Keep its passphrase somewhere safe.';
      exportPassphrase = '';
      exportPassphraseConfirmation = '';
      showEncryptedExport = false;
    } catch (error) {
      errorMessage = messageFor(error, 'The encrypted backup could not be created.');
    } finally {
      exporting = null;
    }
  }

  async function selectBackup(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    preview = null;
    importPassphrase = '';
    errorMessage = '';
    successMessage = '';
    selectedBackup = '';
    selectedFileName = '';
    selectedBackupEncrypted = false;
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      errorMessage = 'The selected backup is larger than the 10 MB safety limit.';
      input.value = '';
      return;
    }

    try {
      selectedBackup = await file.text();
      selectedFileName = file.name;
      const candidate = JSON.parse(selectedBackup) as { format?: unknown };
      selectedBackupEncrypted = candidate.format === 'debt-tracker-backup-encrypted';
    } catch {
      errorMessage = 'The selected file is not valid backup JSON.';
    }
  }

  async function previewImport(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorMessage = '';
    successMessage = '';
    preview = null;
    if (!selectedBackup) {
      errorMessage = 'Choose a backup file first.';
      return;
    }

    importing = true;
    try {
      preview = await backups.preview(
        selectedBackup,
        selectedBackupEncrypted ? importPassphrase : undefined
      );
    } catch (error) {
      errorMessage = messageFor(error, 'The backup could not be read.');
    } finally {
      importing = false;
    }
  }

  async function confirmImport(): Promise<void> {
    if (!preview || !selectedBackup) return;
    importing = true;
    errorMessage = '';
    successMessage = '';
    try {
      const result = await backups.importBackup(
        selectedBackup,
        selectedBackupEncrypted ? importPassphrase : undefined
      );
      importPassphrase = '';
      window.location.assign(resolve(result.activeScenarioId ? '/' : '/setup'));
    } catch (error) {
      errorMessage = messageFor(
        error,
        'The backup could not be restored. Existing data is unchanged.'
      );
      importing = false;
    }
  }
</script>

<svelte:head>
  <title>Settings | Debt Tracker</title>
</svelte:head>

<div class="page-stack settings-page">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Preferences and privacy</p>
      <h1>Settings</h1>
      <p>Manage how your local plan is stored and protected.</p>
    </div>
  </section>

  <section class="settings-section">
    <div class="section-heading">
      <Database size={21} aria-hidden="true" />
      <div>
        <h2>Local data</h2>
        <p>
          {storageMode === 'memory'
            ? 'Your plan lasts only for this open tab.'
            : 'Your plan stays in this browser unless you export it.'}
        </p>
      </div>
    </div>
    <div class="settings-row">
      <div>
        <strong>Storage status</strong>
        <span>
          {loading
            ? 'Checking storage…'
            : storageMode === 'memory'
              ? 'Changes disappear when this tab closes'
              : settings?.activeScenarioId
                ? 'Active plan stored locally'
                : 'No active plan yet'}
        </span>
      </div>
      <span class:warning={storageMode === 'memory'} class="status-pill">
        {#if storageMode === 'memory'}
          <AlertTriangle size={15} aria-hidden="true" /> Session only
        {:else}
          <ShieldCheck size={15} aria-hidden="true" /> Available
        {/if}
      </span>
    </div>
    <div class="settings-row">
      <div><strong>Currency</strong><span>Formatting only — no conversion</span></div>
      <span class="value-pill"
        >{settings?.currency ?? 'GBP'} ({settings?.currency === 'EUR'
          ? '€'
          : settings?.currency === 'USD'
            ? '$'
            : '£'})</span
      >
    </div>
  </section>

  <section class="settings-section" aria-labelledby="backup-heading">
    <div class="section-heading">
      <LockKeyhole size={21} aria-hidden="true" />
      <div>
        <h2 id="backup-heading">Export backup</h2>
        <p>Keep a recoverable copy outside this browser.</p>
      </div>
    </div>
    <div class="backup-panel">
      <div class="sensitive-warning">
        <AlertTriangle size={18} aria-hidden="true" />
        <p>
          <strong>Backups contain sensitive financial data.</strong> Store plain files privately, or use
          encryption before saving them elsewhere.
        </p>
      </div>
      <div class="backup-actions">
        <button
          class="button secondary"
          type="button"
          onclick={exportPlain}
          disabled={exporting !== null}
        >
          <Download size={17} aria-hidden="true" />
          {exporting === 'plain' ? 'Preparing…' : 'Download plain backup'}
        </button>
        <button
          class="button primary"
          type="button"
          onclick={() => (showEncryptedExport = !showEncryptedExport)}
          aria-expanded={showEncryptedExport}
          disabled={exporting !== null}
        >
          <LockKeyhole size={17} aria-hidden="true" /> Download encrypted backup
        </button>
      </div>

      {#if showEncryptedExport}
        <form class="backup-form" onsubmit={exportEncrypted}>
          <div class="form-grid two-columns">
            <label>
              Backup passphrase
              <input
                type="password"
                bind:value={exportPassphrase}
                autocomplete="new-password"
                maxlength="1024"
                required
              />
            </label>
            <label>
              Confirm passphrase
              <input
                type="password"
                bind:value={exportPassphraseConfirmation}
                autocomplete="new-password"
                maxlength="1024"
                required
              />
            </label>
          </div>
          <p class="field-help">
            The passphrase is never stored. A forgotten passphrase cannot be recovered.
          </p>
          <button class="button primary" type="submit" disabled={exporting !== null}>
            <Download size={17} aria-hidden="true" />
            {exporting === 'encrypted' ? 'Encrypting…' : 'Encrypt and download'}
          </button>
        </form>
      {/if}
    </div>
  </section>

  <section class="settings-section" aria-labelledby="restore-heading">
    <div class="section-heading">
      <FileUp size={21} aria-hidden="true" />
      <div>
        <h2 id="restore-heading">Restore backup</h2>
        <p>Validate a backup before replacing data in this browser.</p>
      </div>
    </div>
    <form class="backup-panel backup-form" onsubmit={previewImport}>
      <label class="file-picker">
        Backup file
        <input type="file" accept=".json,application/json" onchange={selectBackup} />
        {#if selectedFileName}<span
            ><FileJson size={16} aria-hidden="true" /> {selectedFileName}</span
          >{/if}
      </label>
      {#if selectedBackupEncrypted}
        <label>
          Backup passphrase
          <input
            type="password"
            bind:value={importPassphrase}
            autocomplete="current-password"
            maxlength="1024"
            required
          />
        </label>
      {/if}
      <button class="button secondary" type="submit" disabled={!selectedBackup || importing}>
        {importing && !preview ? 'Checking…' : 'Check backup'}
      </button>
    </form>

    {#if preview}
      <div class="import-preview" aria-live="polite">
        <div>
          <p class="eyebrow">Backup checked</p>
          <h3>
            {preview.encrypted ? 'Encrypted' : 'Plain'} backup from {formatCalendarDate(
              preview.exportedAt.slice(0, 10)
            )}
          </h3>
          <p>
            {preview.counts.debts} debts · {preview.counts.scenarios} plans · {preview.counts
              .payments} debt payments · {preview.counts.payLaterPlans} pay-later plans · {preview
              .counts.payLaterPayments} pay-later payments · {preview.counts.balanceSnapshots}
            balance records
          </p>
        </div>
        <div class="danger-note">
          <AlertTriangle size={18} aria-hidden="true" />
          <span
            >Restoring replaces all current data in this browser. A failed restore leaves existing
            data unchanged.</span
          >
        </div>
        <button
          class="button danger-button"
          type="button"
          onclick={confirmImport}
          disabled={importing}
        >
          {importing ? 'Restoring…' : 'Replace data and restore'}
        </button>
      </div>
    {/if}
  </section>

  {#if errorMessage}<p class="form-error settings-feedback" role="alert">{errorMessage}</p>{/if}
  {#if successMessage}<p class="form-success settings-feedback" role="status">
      {successMessage}
    </p>{/if}

  <section class="settings-privacy">
    <ShieldCheck size={18} aria-hidden="true" />
    <p>
      <strong>Privacy by design.</strong> Learn what is stored, what deleting browser data does, and how
      to keep a recoverable copy.
    </p>
    <a href={resolve('/privacy')}>Read privacy information</a>
  </section>
</div>
