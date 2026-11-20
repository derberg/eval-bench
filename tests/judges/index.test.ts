import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge, judgeConfigFromConfig } from '../../src/judges/index.js';
import type { Config } from '../../src/types.js';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const isAnthropic = req.url?.includes('/v1/messages');
      res.writeHead(200, { 'content-type': 'application/json' });
      if (isAnthropic) {
        res.end(
          JSON.stringify({ content: [{ type: 'text', text: '{"score":3,"rationale":"x"}' }] }),
        );
      } else if (req.url?.includes('/api/chat')) {
        res.end(JSON.stringify({ message: { content: '{"score":3,"rationale":"x"}' } }));
      } else {
        res.end(
          JSON.stringify({
            choices: [{ message: { content: '{"score":3,"rationale":"x"}' } }],
          }),
        );
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('judge (dispatcher)', () => {
  it('dispatches to ollama', async () => {
    const r = await judge(
      {
        provider: 'ollama',
        model: 'q',
        endpoint: baseUrl,
        apiKeyEnv: null,
        temperature: 0,
        maxTokens: 256,
      },
      { prompt: 'p', output: 'o', rubric: 'r' },
    );
    expect(r.score).toBe(3);
  });

  it('dispatches to openai-compatible', async () => {
    const r = await judge(
      {
        provider: 'openai-compatible',
        model: 'm',
        endpoint: baseUrl + '/v1',
        apiKeyEnv: null,
        temperature: 0,
        maxTokens: 256,
      },
      { prompt: 'p', output: 'o', rubric: 'r' },
    );
    expect(r.score).toBe(3);
  });

  it('reads api key from apiKeyEnv', async () => {
    process.env.TEST_KEY = 'sk-xyz';
    const r = await judge(
      {
        provider: 'anthropic',
        model: 'claude',
        endpoint: baseUrl,
        apiKeyEnv: 'TEST_KEY',
        temperature: 0,
        maxTokens: 256,
      },
      { prompt: 'p', output: 'o', rubric: 'r' },
    );
    expect(r.score).toBe(3);
    delete process.env.TEST_KEY;
  });
  it('passes judge.extraArgs and judge.isolation to the claude-cli judge', async () => {
    // A fake `claude` on PATH that reports its argv as the rationale.
    const bin = mkdtempSync(join(tmpdir(), 'eb-fake-claude-'));
    writeFileSync(
      join(bin, 'claude'),
      `#!/usr/bin/env node\nconsole.log(JSON.stringify({ score: 4, rationale: JSON.stringify(process.argv.slice(2)) }));\n`,
    );
    chmodSync(join(bin, 'claude'), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath}`;
    try {
      const cfg = judgeConfigFromConfig({
        judge: {
          provider: 'claude-cli',
          model: 'sonnet',
          endpoint: null,
          apiKeyEnv: null,
          temperature: 0,
          maxTokens: 256,
          template: null,
          isolation: false,
          extraArgs: ['--marker'],
        },
      } as unknown as Config);
      const r = await judge(cfg, { prompt: 'p', output: 'o', rubric: 'r' });
      const args = JSON.parse(r.rationale) as string[];
      expect(args).toContain('--marker');
      expect(args).not.toContain('--strict-mcp-config');
    } finally {
      process.env.PATH = oldPath;
    }
  });
});
