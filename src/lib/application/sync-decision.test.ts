import { describe, expect, it } from 'vitest';
import { decideSync, type SyncDecisionInput } from './sync-decision';

function decide(overrides: Partial<SyncDecisionInput>) {
  return decideSync({
    baseRevision: 3,
    remoteRevision: 3,
    localDirty: false,
    localEmpty: false,
    ...overrides
  });
}

describe('decideSync', () => {
  it('does nothing when both sides are unchanged', () => {
    expect(decide({})).toBe('noop');
  });

  it('pushes local changes when the remote has not moved', () => {
    expect(decide({ localDirty: true })).toBe('push');
  });

  it('pulls when only the remote changed', () => {
    expect(decide({ remoteRevision: 4 })).toBe('pull');
  });

  it('reports a conflict when both sides changed', () => {
    expect(decide({ remoteRevision: 4, localDirty: true })).toBe('conflict');
  });

  it('pushes when the cloud is empty', () => {
    expect(decide({ baseRevision: null, remoteRevision: 0, localDirty: true })).toBe('push');
    expect(decide({ baseRevision: 5, remoteRevision: 0 })).toBe('push');
  });

  it('skips uploading an empty never-synced device to an empty cloud', () => {
    expect(decide({ baseRevision: null, remoteRevision: 0, localEmpty: true })).toBe('noop');
  });

  it('pulls onto a never-synced empty device', () => {
    expect(decide({ baseRevision: null, remoteRevision: 2, localEmpty: true })).toBe('pull');
  });

  it('asks before replacing data on a never-synced device', () => {
    expect(decide({ baseRevision: null, remoteRevision: 2, localDirty: true })).toBe('conflict');
  });

  it('treats a remote reset below the base like a remote change', () => {
    expect(decide({ baseRevision: 9, remoteRevision: 2 })).toBe('pull');
    expect(decide({ baseRevision: 9, remoteRevision: 2, localDirty: true })).toBe('conflict');
  });
});
