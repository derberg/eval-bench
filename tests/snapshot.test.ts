import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveSnapshot,
  loadSnapshot,
  listSnapshots,
  removeSnapshot,
} from '../src/snapshot.js';
import type { Snapshot } from '../src/types.js';

function makeSnap(name: string): Snapshot {
  return {
    schemaVersion: 1,
    name,
    createdAt: '2026-04-23T10:00:00Z',
    plugin: { path: '/x', baselineRef: 'v1', baselineSha: 'a', currentRef: 'v2', currentSha: 'b' },
    config: {} as Snapshot['config'],
    judge: { provider: 'ollama', model: 'q' },
    prompts: [],
    runs: [],
    judgments: [],
    summary: {
      baseline: { n: 0, mean: 0, median: 0, variance: 0 },
      current: { n: 0, mean: 0, median: 0, variance: 0 },
      delta: 0,
    },
  };
}

describe('snapshot io', () => {
  it('saves, lists, loads, removes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-snap-'));
    const snap = makeSnap('v1-baseline');
    const p = await saveSnapshot(snap, dir);
    expect(p).toMatch(/v1-baseline/);
    const list = await listSnapshots(dir);
    expect(list).toEqual(['v1-baseline']);
    const loaded = await loadSnapshot(dir, 'v1-baseline');
    expect(loaded.name).toBe('v1-baseline');
    await removeSnapshot(dir, 'v1-baseline');
    expect(await listSnapshots(dir)).toEqual([]);
  });

  it('rejects names with path traversal', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-snap-'));
    const snap = makeSnap('../escape');
    await expect(saveSnapshot(snap, dir)).rejects.toThrow(/snapshot name/);
  });

  it('returns empty list when dir does not exist', async () => {
    const list = await listSnapshots('/nonexistent/path/here/x');
    expect(list).toEqual([]);
  });
});
