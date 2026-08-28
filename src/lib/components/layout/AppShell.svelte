<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { ChartNoAxesCombined, CircleGauge, Home, Settings, WalletCards } from '@lucide/svelte';
  import SaveStatus from '$lib/components/shared/SaveStatus.svelte';

  let { children } = $props();

  const navItems = [
    { href: '/', label: 'Home', icon: Home },
    { href: '/debts', label: 'Debts', icon: WalletCards },
    { href: '/plan', label: 'Plan', icon: ChartNoAxesCombined },
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
      <p>Your financial data never leaves this browser.</p>
    </div>
  </aside>

  <div class="main-shell">
    <header class="topbar">
      <a class="mobile-brand" href={resolve('/')} aria-label="Debt Tracker home">
        <CircleGauge size={21} aria-hidden="true" />
        <span>Debt Tracker</span>
      </a>
      <SaveStatus />
    </header>

    <main id="main-content" tabindex="-1">
      {@render children()}
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
