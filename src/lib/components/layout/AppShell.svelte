<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import {
    CalendarClock,
    ChartNoAxesCombined,
    CircleGauge,
    Cloud,
    Home,
    Settings,
    WalletCards
  } from '@lucide/svelte';
  import SaveStatus from '$lib/components/shared/SaveStatus.svelte';
  import SyncStatus from '$lib/components/shared/SyncStatus.svelte';
  import UpdatePrompt from '$lib/components/shared/UpdatePrompt.svelte';
  import { syncController } from '$lib/sync/sync-controller.svelte';

  let { children } = $props();

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/debts', label: 'Debts', icon: WalletCards },
    { href: '/plan', label: 'Plan', icon: ChartNoAxesCombined },
    { href: '/pay-later', label: 'Pay later', icon: CalendarClock },
    { href: '/settings', label: 'Settings', icon: Settings }
  ] as const;

  function isActive(href: string): boolean {
    return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
  }
</script>

<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
<a class="skip-link" href="#main-content">Skip to main content</a>

<div class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <a class="brand" href={resolve('/')} aria-label="Debt Tracker home">
      <span class="brand-mark"><CircleGauge size={22} aria-hidden="true" /></span>
      <span>Debt Tracker</span>
    </a>

    <nav class="desktop-nav" aria-label="Main menu">
      {#each navItems as item (item.href)}
        <a
          class:active={isActive(item.href)}
          href={resolve(item.href)}
          aria-current={isActive(item.href) ? 'page' : undefined}
        >
          <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>

    <div class="sidebar-privacy">
      <SaveStatus compact />
      <SyncStatus compact />
      <p>
        {syncController.enabled
          ? 'Your data is encrypted on this device before it syncs.'
          : 'Your financial data never leaves this browser.'}
      </p>
    </div>
  </aside>

  <div class="main-shell">
    <header class="topbar">
      <a class="mobile-brand" href={resolve('/')} aria-label="Debt Tracker home">
        <CircleGauge size={21} aria-hidden="true" />
        <span>Debt Tracker</span>
      </a>
      <div class="topbar-status">
        <SaveStatus />
        <SyncStatus />
      </div>
    </header>

    <UpdatePrompt />

    {#if syncController.remoteChangesApplied}
      <div class="system-notices">
        <section class="system-notice update-notice" role="status" aria-live="polite">
          <Cloud size={19} aria-hidden="true" />
          <div>
            <strong>Changes synced from another device</strong>
            <span>Refresh this view to see the latest data.</span>
          </div>
          <button
            class="button secondary"
            type="button"
            onclick={() => syncController.refreshView()}
          >
            Refresh view
          </button>
        </section>
      </div>
    {/if}

    <main id="main-content" tabindex="-1">
      {#key syncController.viewVersion}
        {@render children()}
      {/key}
    </main>
  </div>

  <nav class="bottom-nav" aria-label="Main menu">
    {#each navItems as item (item.href)}
      <a
        class:active={isActive(item.href)}
        href={resolve(item.href)}
        aria-current={isActive(item.href) ? 'page' : undefined}
      >
        <item.icon size={20} strokeWidth={1.8} aria-hidden="true" />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
</div>
