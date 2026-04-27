import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithOpenRouter } from '../../src/judges/openrouter.js';

let server: Server;
let baseUrl = '';
let receivedAuth = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedAuth = (req.headers['authorization'] as string) ?? '';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            { message: { role: 'assistant', content: '{"score": 3.5, "rationale": "ok"}' } },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('judgeWithOpenRouter', () => {
  it('sends Authorization: Bearer and parses choices[0].message.content', async () => {
    const r = await judgeWithOpenRouter({
      endpoint: baseUrl,
      apiKey: 'sk-or-test',
      model: 'meta-llama/llama-3.3-70b-instruct',
      temperature: 0,
      maxTokens: 256,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(receivedAuth).toBe('Bearer sk-or-test');
    expect(r.score).toBe(3.5);
    expect(r.rationale).toBe('ok');
  });
});
