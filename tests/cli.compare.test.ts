import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareCommand } from '../src/cli/compare.js';

function seed(dir: string, name: string, scoreCurrent: number): void {
  mkdirSync(join(dir, name), { recursive: true });
  const base = {
    schemaVersion: 1,
    name,
    createdAt: '2026-04-23T00:00:00Z',
    plugin: { path: '', baselineRef: '', baselineSha: '', currentRef: '', currentSha: '' },
    config: {},
    judge: { provider: 'ollama', model: 'q' },
    prompts: [{ id: 'p1', prompt: 'x', rubric: 'r' }],
    runs: [
      {
        id: 'p1::current::1',
        promptId: 'p1',
        variant: 'current',
        sample: 1,
        output: '',
        durationMs: 1,
        exitCode: 0,
        error: null,
      },
    ],
    judgments: [
      {
        runId: 'p1::current::1',
        score: scoreCurrent,
        rationale: '',
        rubricHash: '',
        judgeProvider: 'ollama',
        judgeModel: 'q',
        raw: '',
      },
    ],
    summary: {
      baseline: { n: 0, mean: 0, median: 0, variance: 0 },
      current: { n: 1, mean: scoreCurrent, median: scoreCurrent, variance: 0 },
      delta: 0,
    },
  };
  writeFileSync(join(dir, name, 'snapshot.json'), JSON.stringify(base));
}

describe('ef compare', () => {
  it('emits markdown by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-cmp-'));
    seed(dir, 'a', 3);
    seed(dir, 'b', 4);
    const out = await compareCommand({ dir, from: 'a', to: 'b', format: 'md' });
    expect(out).toContain('# Benchmark comparison: `a` → `b`');
    expect(out).toContain('| p1 |');
  });

  it('emits json when requested', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-cmp-'));
    seed(dir, 'a', 3);
    seed(dir, 'b', 4);
    const out = await compareCommand({ dir, from: 'a', to: 'b', format: 'json' });
    const obj = JSON.parse(out);
    expect(obj.from).toBe('a');
    expect(obj.to).toBe('b');
    expect(obj.perPrompt[0].delta).toBe(1);
  });
});
