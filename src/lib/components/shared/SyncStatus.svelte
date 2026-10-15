<script lang="ts">
  import { resolve } from '$app/paths';
  import { AlertTriangle, Cloud, CloudOff, LoaderCircle, LockKeyhole } from '@lucide/svelte';
  import { syncController } from '$lib/sync/sync-controller.svelte';

  let { compact = false } = $props<{ compact?: boolean }>();

  const labels = {
    disabled: '',
    locked: 'Sync locked',
    syncing: 'Syncing…',
    synced: 'Synced',
    conflict: 'Sync needs you',
    offline: 'Sync offline',
    error: 'Sync failed',
    'signed-out': 'Sync signed out'
  } as const;

  let status = $derived(syncController.status);
  let warning = $derived(status === 'conflict' || status === 'error' || status === 'signed-out');
</script>

{#if status !== 'disabled'}
  <a
    class:compact
    class:error={warning}
    class="save-status sync-status"
    href={resolve('/account')}
    aria-live="polite"
  >
    {#if warning}
      <AlertTriangle size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
    {:else if status === 'syncing'}
      <LoaderCircle
        class="save-status-spinner"
        size={compact ? 16 : 17}
        strokeWidth={2}
        aria-hidden="true"
      />
    {:else if status === 'locked'}
      <LockKeyhole size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
    {:else if status === 'offline'}
      <CloudOff size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
    {:else}
      <Cloud size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
    {/if}
    <span>{labels[status]}</span>
  </a>
{/if}
