import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judge } from '../../src/judges/index.js';

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
});
