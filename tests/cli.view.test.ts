import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { viewCommand } from '../src/cli/view.js';

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
      prompts: [{ id: 'p1', prompt: 'x', rubric: 'r' }],
      runs: [
        {
          id: 'p1::baseline::1',
          promptId: 'p1',
          variant: 'baseline',
          sample: 1,
          output: 'hi',
          durationMs: 1,
          exitCode: 0,
          error: null,
        },
      ],
      judgments: [
        {
          runId: 'p1::baseline::1',
          score: 4,
          rationale: 'ok',
          rubricHash: '',
          judgeProvider: 'ollama',
          judgeModel: 'q',
          raw: '',
        },
      ],
      summary: {
        baseline: { n: 1, mean: 4, median: 4, variance: 0 },
        current: { n: 0, mean: 0, median: 0, variance: 0 },
        delta: -4,
      },
    }),
  );
}

describe('ef view', () => {
  it('generates an HTML file under snapshot dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-view-'));
    seed(dir, 'a');
    const html = await viewCommand({ dir, name: 'a', writeHtml: true, open: false });
    expect(existsSync(join(dir, 'a', 'view.html'))).toBe(true);
    expect(html).toContain('<html');
    expect(html).toContain('p1');
    expect(html).toContain('score 4');
  });
});
