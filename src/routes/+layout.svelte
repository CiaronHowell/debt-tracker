<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { afterNavigate, goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import AppShell from '$lib/components/layout/AppShell.svelte';
  import { PlanService } from '$lib/application';
  import { getDatabase } from '$lib/persistence';
  import { syncController } from '$lib/sync/sync-controller.svelte';

  let { children } = $props();
  let shellReady = $state(false);

  onMount(() => syncController.start());

  async function enforceSetup(): Promise<void> {
    const path = page.url.pathname;
    if (
      path.startsWith('/setup') ||
      path.startsWith('/settings') ||
      path.startsWith('/privacy') ||
      path.startsWith('/account')
    ) {
      shellReady = true;
      return;
    }

    shellReady = false;
    try {
      const settings = await new PlanService(getDatabase()).getSettings();
      if (!settings?.setupCompletedAt) {
        await goto(resolve('/setup'), { replaceState: true });
        return;
      }
    } finally {
      shellReady = true;
    }
  }

  afterNavigate(() => {
    void enforceSetup();
  });
</script>

{#if shellReady}
  <AppShell>
    {@render children()}
  </AppShell>
{:else}
  <div class="app-loading" role="status">Opening your private plan…</div>
{/if}
