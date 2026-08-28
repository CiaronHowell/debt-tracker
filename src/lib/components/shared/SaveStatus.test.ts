import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SaveStatus from './SaveStatus.svelte';
import { setPersistenceMode } from '$lib/persistence/storage-mode';
import {
  PERSISTENCE_WRITE_ERROR_EVENT,
  PERSISTENCE_WRITE_START_EVENT,
  PERSISTENCE_WRITE_SUCCESS_EVENT
} from '$lib/persistence';

afterEach(() => setPersistenceMode('persistent'));

describe('SaveStatus', () => {
  it('communicates that data is saved locally', () => {
    render(SaveStatus);

    expect(screen.getByRole('status').textContent).toContain('Saved on this device');
  });

  it('uses the private-device label in compact mode', () => {
    render(SaveStatus, { compact: true });

    expect(screen.getByRole('status').textContent).toContain('Private on this device');
  });

  it('never claims ephemeral session data was saved', async () => {
    setPersistenceMode('memory');
    render(SaveStatus);

    expect(screen.getByRole('status').textContent).toContain('Session only — not saved');
    window.dispatchEvent(new Event(PERSISTENCE_WRITE_SUCCESS_EVENT));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Session only — not saved')
    );
  });

  it('reports saving, successful persistence, and a recoverable failure', async () => {
    render(SaveStatus);
    window.dispatchEvent(new Event(PERSISTENCE_WRITE_START_EVENT));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Saving…'));

    window.dispatchEvent(new Event(PERSISTENCE_WRITE_SUCCESS_EVENT));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Saved on this device')
    );

    window.dispatchEvent(new Event(PERSISTENCE_WRITE_ERROR_EVENT));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Save failed — try again')
    );
  });
});
