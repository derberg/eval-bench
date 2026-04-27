import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { runBenchmark } from '../src/run.js';
import type { Config, PromptSpec } from '../src/types.js';

let server: Server;
let judgeUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          message: { content: '{"score": 4, "rationale": "ok"}' },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) judgeUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const fakeClaude = resolve('tests/fixtures/fake-claude.js');
chmodSync(fakeClaude, 0o755);

const prompts: PromptSpec[] = [{ id: 'p1', prompt: 'x', rubric: 'r' }];

function baseConfig(): Config {
  return {
    plugin: { path: '/tmp/plugin', gitRoot: '/tmp/plugin' },
    provider: {
      command: 'node',
      extraArgs: [fakeClaude],
      timeout: 30,
      model: null,
      allowedTools: null,
    },
    judge: {
      provider: 'ollama',
      model: 'q',
      endpoint: judgeUrl,
      apiKeyEnv: null,
      temperature: 0,
      maxTokens: 256,
    },
    runs: { samples: 2, parallel: 2 },
    snapshots: { dir: '/tmp/snaps' },
  };
}

describe('runBenchmark', () => {
  it('runs the full matrix and judges each output', async () => {
    const snap = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test',
    });
    expect(snap.runs).toHaveLength(4);
    expect(snap.judgments).toHaveLength(4);
    expect(snap.judgments.every((j) => j.score === 4)).toBe(true);
    expect(snap.summary.baseline.n).toBe(2);
    expect(snap.summary.current.n).toBe(2);
  });
});
