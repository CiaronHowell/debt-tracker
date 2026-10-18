<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { AlertTriangle, Cloud, LockKeyhole, LogOut, RefreshCw } from '@lucide/svelte';
  import { AppError, type ConflictChoice } from '$lib/application';
  import { syncController } from '$lib/sync/sync-controller.svelte';
  import { LOGIN_API_PATH } from '$lib/sync/protocol';
  import { formatCalendarDate } from '$lib/utils/dates';

  let loading = $state(true);
  let login = $state<string | null>(null);
  let unavailable = $state(false);
  let remoteRevision = $state(0);
  let passphrase = $state('');
  let passphraseConfirmation = $state('');
  let remember = $state(false);
  let working = $state(false);
  let errorMessage = $state('');

  const denied = page.url.searchParams.has('denied');
  const signInFailed = page.url.searchParams.has('error');
  let firstUpload = $derived(remoteRevision === 0);

  const statusLabels = {
    disabled: 'Not syncing',
    locked: 'Locked',
    syncing: 'Syncing…',
    synced: 'Synced',
    conflict: 'Needs your choice',
    offline: 'Offline',
    error: 'Sync failed',
    'signed-out': 'Signed out'
  } as const;

  onMount(async () => {
    try {
      const session = await syncController.sync.getSession();
      login = session.login;
      if (session.authenticated) {
        syncController.enable();
        await syncController.ready();
        if (!syncController.unlocked)
          remoteRevision = await syncController.sync.getRemoteRevision();
      }
    } catch (error) {
      unavailable = true;
      errorMessage = messageFor(error, 'Owner sync is unavailable on this deployment.');
    } finally {
      loading = false;
    }
  });

  function messageFor(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  async function unlock(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    errorMessage = '';
    if (firstUpload && passphrase !== passphraseConfirmation) {
      errorMessage = 'The passphrases do not match.';
      return;
    }
    working = true;
    try {
      await syncController.unlock(passphrase, remember);
      passphrase = '';
      passphraseConfirmation = '';
    } catch (error) {
      errorMessage = messageFor(error, 'Sync could not be unlocked.');
      if (error instanceof AppError && error.code === 'SYNC_UNAUTHORIZED') login = null;
    } finally {
      working = false;
    }
  }

  async function resolveConflict(choice: ConflictChoice): Promise<void> {
    working = true;
    try {
      await syncController.resolveConflict(choice);
    } finally {
      working = false;
    }
  }

  async function signOut(): Promise<void> {
    working = true;
    try {
      await syncController.signOut();
      login = null;
    } finally {
      working = false;
    }
  }

  function summary(counts: {
    debts: number;
    scenarios: number;
    payments: number;
    payLaterPlans: number;
  }): string {
    return `${counts.debts} debts · ${counts.scenarios} plans · ${counts.payments} payments · ${counts.payLaterPlans} pay-later plans`;
  }
</script>

<svelte:head>
  <title>Owner sync | Debt Tracker</title>
</svelte:head>

<div class="page-stack settings-page">
  <section class="page-heading">
    <div>
      <p class="eyebrow">Owner only</p>
      <h1>Cloud sync</h1>
      <p>Keep this plan in step across your own devices. Data is encrypted before it leaves.</p>
    </div>
  </section>

  {#if loading}
    <p role="status">Checking sign-in…</p>
  {:else if unavailable}
    <p class="form-error settings-feedback" role="alert">{errorMessage}</p>
  {:else if !login || syncController.status === 'signed-out'}
    <section class="settings-section" aria-labelledby="sign-in-heading">
      <div class="section-heading">
        <Cloud size={21} aria-hidden="true" />
        <div>
          <h2 id="sign-in-heading">Sign in</h2>
          <p>Only the owner's GitHub account can sign in. Everyone else keeps a local-only plan.</p>
        </div>
      </div>
      {#if denied}
        <p class="form-error" role="alert">That GitHub account is not allowed to sync.</p>
      {:else if signInFailed}
        <p class="form-error" role="alert">Sign-in did not complete. Try again.</p>
      {/if}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a class="button primary" href={LOGIN_API_PATH} data-sveltekit-reload>Sign in with GitHub</a>
    </section>
  {:else}
    <section class="settings-section" aria-labelledby="sync-heading">
      <div class="section-heading">
        <Cloud size={21} aria-hidden="true" />
        <div>
          <h2 id="sync-heading">Signed in as {login}</h2>
          <p>
            Status: <strong data-testid="sync-status">{statusLabels[syncController.status]}</strong>
            {#if syncController.lastSyncedAt}
              · last synced {formatCalendarDate(syncController.lastSyncedAt.slice(0, 10))}
              {syncController.lastSyncedAt.slice(11, 16)} UTC
            {/if}
          </p>
        </div>
      </div>

      {#if !syncController.unlocked}
        <form class="backup-panel backup-form" onsubmit={unlock}>
          <div class:two-columns={firstUpload} class="form-grid">
            <label>
              Sync passphrase
              <input
                type="password"
                bind:value={passphrase}
                autocomplete={firstUpload ? 'new-password' : 'current-password'}
                maxlength="1024"
                required
              />
            </label>
            {#if firstUpload}
              <label>
                Confirm passphrase
                <input
                  type="password"
                  bind:value={passphraseConfirmation}
                  autocomplete="new-password"
                  maxlength="1024"
                  required
                />
              </label>
            {/if}
          </div>
          <p class="field-help">
            {firstUpload
              ? 'Choose a passphrase to encrypt your cloud copy. It is never sent or stored, and cannot be recovered.'
              : 'Enter the passphrase you chose when you first synced. It stays in memory until you reload, unless you remember this device.'}
          </p>
          {#if syncController.canRemember}
            <label class="remember-device">
              <input type="checkbox" bind:checked={remember} aria-describedby="remember-help" />
              Remember this device
            </label>
            <p class="field-help" id="remember-help">
              Unlock automatically after a reload. Anyone who can use this browser profile could
              then sync your data.
            </p>
          {/if}
          <button class="button primary" type="submit" disabled={working}>
            <LockKeyhole size={17} aria-hidden="true" />
            {working ? 'Unlocking…' : firstUpload ? 'Encrypt and upload' : 'Unlock and sync'}
          </button>
        </form>
      {:else if syncController.status === 'conflict' && syncController.conflict}
        <div class="import-preview" aria-live="polite">
          <div>
            <p class="eyebrow">Both copies changed</p>
            <h3>Choose which data to keep</h3>
            <p><strong>This device:</strong> {summary(syncController.conflict.local)}</p>
            <p>
              <strong>Cloud copy</strong>
              {#if syncController.conflict.remoteUpdatedAt}
                (saved {formatCalendarDate(syncController.conflict.remoteUpdatedAt.slice(0, 10))})
              {/if}: {summary(syncController.conflict.remote)}
            </p>
          </div>
          <div class="danger-note">
            <AlertTriangle size={18} aria-hidden="true" />
            <span>The copy you don't choose is replaced. The cloud keeps its last 10 versions.</span
            >
          </div>
          <div class="backup-actions">
            <button
              class="button secondary"
              type="button"
              disabled={working}
              onclick={() => resolveConflict('use-cloud')}
            >
              Use cloud copy
            </button>
            <button
              class="button primary"
              type="button"
              disabled={working}
              onclick={() => resolveConflict('keep-device')}
            >
              Keep this device's data
            </button>
          </div>
        </div>
      {:else}
        {#if syncController.remembered}
          <p class="field-help">This device remembers your passphrase. Lock to forget it.</p>
        {/if}
        <div class="backup-actions">
          <button
            class="button primary"
            type="button"
            disabled={syncController.status === 'syncing'}
            onclick={() => syncController.syncNow({ background: false })}
          >
            <RefreshCw size={17} aria-hidden="true" /> Sync now
          </button>
          <button class="button secondary" type="button" onclick={() => syncController.lock()}>
            <LockKeyhole size={17} aria-hidden="true" /> Lock
          </button>
          <a class="button secondary" href={resolve('/')}>Open plan</a>
        </div>
      {/if}

      {#if syncController.message}
        <p class="form-error" role="alert">{syncController.message}</p>
      {/if}
      {#if errorMessage}<p class="form-error" role="alert">{errorMessage}</p>{/if}

      <div class="backup-actions">
        <button class="button secondary" type="button" disabled={working} onclick={signOut}>
          <LogOut size={17} aria-hidden="true" /> Sign out and stop syncing on this device
        </button>
      </div>
    </section>
  {/if}
</div>
