import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import SaveStatus from './SaveStatus.svelte';

describe('SaveStatus', () => {
  it('communicates that data is saved locally', () => {
    render(SaveStatus);

    expect(screen.getByRole('status').textContent).toContain('Saved on this device');
  });

  it('uses the private-device label in compact mode', () => {
    render(SaveStatus, { compact: true });

    expect(screen.getByRole('status').textContent).toContain('Private on this device');
  });
});
