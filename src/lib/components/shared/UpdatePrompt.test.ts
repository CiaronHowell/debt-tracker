import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UpdatePrompt from './UpdatePrompt.svelte';
import { PERSISTENCE_WRITE_START_EVENT, PERSISTENCE_WRITE_SUCCESS_EVENT } from '$lib/persistence';
import { setPersistenceMode } from '$lib/persistence/storage-mode';

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalOnLine = Object.getOwnPropertyDescriptor(navigator, 'onLine');

afterEach(() => {
  setPersistenceMode('persistent');
  if (originalServiceWorker)
    Object.defineProperty(navigator, 'serviceWorker', originalServiceWorker);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
  if (originalOnLine) Object.defineProperty(navigator, 'onLine', originalOnLine);
  vi.restoreAllMocks();
});

describe('UpdatePrompt', () => {
  it('announces that existing local features remain available offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(UpdatePrompt);

    expect(await screen.findByText('You are offline')).toBeTruthy();
    expect(screen.getByText(/saved plan and calculator remain available/i)).toBeTruthy();
  });

  it('warns that memory-only changes disappear and keeps backup reachable', async () => {
    setPersistenceMode('memory');
    render(UpdatePrompt);

    expect(await screen.findByText('Storage is unavailable — session only')).toBeTruthy();
    expect(screen.getByText(/changes disappear when this tab closes/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Export backup' }).getAttribute('href')).toBe(
      '/settings'
    );
  });

  it('waits for an active write before activating a waiting update', async () => {
    const postMessage = vi.fn();
    const registration = Object.assign(new EventTarget(), {
      waiting: { postMessage },
      installing: null,
      update: vi.fn().mockResolvedValue(undefined)
    }) as unknown as ServiceWorkerRegistration;
    const serviceWorker = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration)
    }) as unknown as ServiceWorkerContainer;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: serviceWorker
    });
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });

    render(UpdatePrompt);
    const reload = await screen.findByRole('button', { name: 'Reload app' });
    window.dispatchEvent(new Event(PERSISTENCE_WRITE_START_EVENT));
    await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(true));
    expect(reload.textContent).toContain('Waiting for save…');

    window.dispatchEvent(new Event(PERSISTENCE_WRITE_SUCCESS_EVENT));
    await waitFor(() => expect((reload as HTMLButtonElement).disabled).toBe(false));
    await fireEvent.click(reload);
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });
});
