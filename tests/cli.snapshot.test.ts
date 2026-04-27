import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotList, snapshotShow, snapshotRm } from '../src/cli/snapshot.js';

function seed(dir: string, name: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, 'snapshot.json'),
    JSON.stringify({
      schemaVersion: 1,
      name,
      createdAt: '2026-04-23T00:00:00Z',
      plugin: { path: '', baselineRef: '', baselineSha: '', currentRef: '', currentSha: '' },
      config: {},
      judge: { provider: 'ollama', model: 'q' },
      prompts: [],
      runs: [],
      judgments: [],
      summary: {
        baseline: { n: 1, mean: 3, median: 3, variance: 0 },
        current: { n: 1, mean: 3.5, median: 3.5, variance: 0 },
        delta: 0.5,
      },
    }),
  );
}

describe('ef snapshot', () => {
  it('list / show / rm', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-snapcli-'));
    seed(dir, 'a');
    seed(dir, 'b');
    const list = await snapshotList(dir);
    expect(list).toEqual(['a', 'b']);
    const summary = await snapshotShow(dir, 'a');
    expect(summary).toMatch(/baseline mean 3.00/);
    expect(summary).toMatch(/delta {4}\+0\.50/);
    await snapshotRm(dir, 'a');
    expect(await snapshotList(dir)).toEqual(['b']);
  });
});
