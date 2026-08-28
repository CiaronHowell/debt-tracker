<script lang="ts">
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';
  import { AlertTriangle, CloudOff, RefreshCw } from '@lucide/svelte';
  import {
    getPersistenceMode,
    PERSISTENCE_MODE_CHANGE_EVENT,
    PERSISTENCE_WRITE_ERROR_EVENT,
    PERSISTENCE_WRITE_START_EVENT,
    PERSISTENCE_WRITE_SUCCESS_EVENT
  } from '$lib/persistence';

  let online = $state(true);
  let memoryOnly = $state(getPersistenceMode() === 'memory');
  let updateAvailable = $state(false);
  let pendingWrites = $state(0);
  let registration = $state<ServiceWorkerRegistration | null>(null);
  let reloadRequested = false;

  onMount(() => {
    online = navigator.onLine;
    memoryOnly = getPersistenceMode() === 'memory';
    let trackedRegistration: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;

    const handleOnline = () => (online = true);
    const handleOffline = () => (online = false);
    const handleModeChange = () => (memoryOnly = getPersistenceMode() === 'memory');
    const handleWriteStart = () => (pendingWrites += 1);
    const handleWriteEnd = () => (pendingWrites = Math.max(0, pendingWrites - 1));
    const handleControllerChange = () => {
      if (reloadRequested) window.location.reload();
    };
    const handleInstallingState = () => {
      if (installingWorker?.state === 'installed' && navigator.serviceWorker.controller) {
        updateAvailable = true;
      }
    };
    const handleUpdateFound = () => {
      installingWorker?.removeEventListener('statechange', handleInstallingState);
      installingWorker = trackedRegistration?.installing ?? null;
      installingWorker?.addEventListener('statechange', handleInstallingState);
    };
    const trackRegistration = (next: ServiceWorkerRegistration): void => {
      if (trackedRegistration === next) return;
      trackedRegistration?.removeEventListener('updatefound', handleUpdateFound);
      trackedRegistration = next;
      registration = next;
      if (next.waiting && navigator.serviceWorker.controller) updateAvailable = true;
      next.addEventListener('updatefound', handleUpdateFound);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener(PERSISTENCE_MODE_CHANGE_EVENT, handleModeChange);
    window.addEventListener(PERSISTENCE_WRITE_START_EVENT, handleWriteStart);
    window.addEventListener(PERSISTENCE_WRITE_SUCCESS_EVENT, handleWriteEnd);
    window.addEventListener(PERSISTENCE_WRITE_ERROR_EVENT, handleWriteEnd);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
      void navigator.serviceWorker.getRegistration().then((current) => {
        if (current) trackRegistration(current);
      });
      void navigator.serviceWorker.ready.then((ready) => {
        trackRegistration(ready);
        return ready.update();
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener(PERSISTENCE_MODE_CHANGE_EVENT, handleModeChange);
      window.removeEventListener(PERSISTENCE_WRITE_START_EVENT, handleWriteStart);
      window.removeEventListener(PERSISTENCE_WRITE_SUCCESS_EVENT, handleWriteEnd);
      window.removeEventListener(PERSISTENCE_WRITE_ERROR_EVENT, handleWriteEnd);
      navigator.serviceWorker?.removeEventListener('controllerchange', handleControllerChange);
      trackedRegistration?.removeEventListener('updatefound', handleUpdateFound);
      installingWorker?.removeEventListener('statechange', handleInstallingState);
    };
  });

  function applyUpdate(): void {
    if (pendingWrites > 0 || !registration?.waiting) return;
    reloadRequested = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
</script>

{#if memoryOnly || !online || updateAvailable}
  <div class="system-notices">
    {#if memoryOnly}
      <section class="system-notice memory-notice" role="alert">
        <AlertTriangle size={19} aria-hidden="true" />
        <div>
          <strong>Storage is unavailable — session only</strong>
          <span>Changes disappear when this tab closes. Export a backup to preserve this plan.</span
          >
        </div>
        <a class="button secondary" href={resolve('/settings')}>Export backup</a>
      </section>
    {/if}

    {#if !online}
      <section class="system-notice offline-notice" role="status" aria-live="polite">
        <CloudOff size={19} aria-hidden="true" />
        <div>
          <strong>You are offline</strong>
          <span>
            {memoryOnly
              ? 'This calculator session remains available while the tab stays open.'
              : 'Your saved plan and calculator remain available on this device.'}
          </span>
        </div>
      </section>
    {/if}

    {#if updateAvailable}
      <section class="system-notice update-notice" role="status" aria-live="polite">
        <RefreshCw size={19} aria-hidden="true" />
        <div>
          <strong>App update ready</strong>
          <span>
            {memoryOnly
              ? 'Export a backup before reloading this session.'
              : 'Your saved plan will stay on this device.'}
          </span>
        </div>
        <button
          class="button secondary"
          type="button"
          disabled={pendingWrites > 0}
          onclick={applyUpdate}
        >
          {pendingWrites > 0 ? 'Waiting for save…' : 'Reload app'}
        </button>
      </section>
    {/if}
  </div>
{/if}
