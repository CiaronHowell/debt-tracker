<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertTriangle, LoaderCircle, ShieldCheck } from '@lucide/svelte';
  import {
    getPersistenceMode,
    PERSISTENCE_MODE_CHANGE_EVENT,
    PERSISTENCE_WRITE_ERROR_EVENT,
    PERSISTENCE_WRITE_START_EVENT,
    PERSISTENCE_WRITE_SUCCESS_EVENT
  } from '$lib/persistence';

  let { compact = false } = $props<{ compact?: boolean }>();
  let saveState = $state<'saved' | 'saving' | 'error'>('saved');
  let memoryOnly = $state(getPersistenceMode() === 'memory');

  let label = $derived(
    memoryOnly
      ? compact
        ? 'Session only'
        : 'Session only — not saved'
      : saveState === 'saving'
        ? 'Saving…'
        : saveState === 'error'
          ? 'Save failed — try again'
          : compact
            ? 'Private on this device'
            : 'Saved on this device'
  );

  onMount(() => {
    memoryOnly = getPersistenceMode() === 'memory';
    const handleModeChange = () => (memoryOnly = getPersistenceMode() === 'memory');
    const handleStart = () => (saveState = 'saving');
    const handleSuccess = () => (saveState = 'saved');
    const handleError = () => (saveState = 'error');
    window.addEventListener(PERSISTENCE_MODE_CHANGE_EVENT, handleModeChange);
    window.addEventListener(PERSISTENCE_WRITE_START_EVENT, handleStart);
    window.addEventListener(PERSISTENCE_WRITE_SUCCESS_EVENT, handleSuccess);
    window.addEventListener(PERSISTENCE_WRITE_ERROR_EVENT, handleError);
    return () => {
      window.removeEventListener(PERSISTENCE_MODE_CHANGE_EVENT, handleModeChange);
      window.removeEventListener(PERSISTENCE_WRITE_START_EVENT, handleStart);
      window.removeEventListener(PERSISTENCE_WRITE_SUCCESS_EVENT, handleSuccess);
      window.removeEventListener(PERSISTENCE_WRITE_ERROR_EVENT, handleError);
    };
  });
</script>

<div
  class:compact
  class:memory={memoryOnly}
  class:saving={!memoryOnly && saveState === 'saving'}
  class:error={!memoryOnly && saveState === 'error'}
  class="save-status"
  role="status"
  aria-live="polite"
>
  {#if memoryOnly || saveState === 'error'}
    <AlertTriangle size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
  {:else if saveState === 'saving'}
    <LoaderCircle
      class="save-status-spinner"
      size={compact ? 16 : 17}
      strokeWidth={2}
      aria-hidden="true"
    />
  {:else}
    <ShieldCheck size={compact ? 16 : 17} strokeWidth={2} aria-hidden="true" />
  {/if}
  <span>{label}</span>
</div>
