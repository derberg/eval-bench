import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithOpenAI } from '../../src/judges/openai.js';

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
            { message: { role: 'assistant', content: '{"score": 2.5, "rationale": "meh"}' } },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}/v1`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('judgeWithOpenAI', () => {
  it('sends Authorization: Bearer and parses choices[0].message.content', async () => {
    const r = await judgeWithOpenAI({
      endpoint: baseUrl,
      apiKey: 'sk-test',
      model: 'gpt-4o',
      temperature: 0,
      maxTokens: 256,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(receivedAuth).toBe('Bearer sk-test');
    expect(r.score).toBe(2.5);
    expect(r.rationale).toBe('meh');
  });
});
