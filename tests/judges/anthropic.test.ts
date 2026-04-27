import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithAnthropic } from '../../src/judges/anthropic.js';

let server: Server;
let baseUrl = '';
let receivedAuth = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedAuth = (req.headers['x-api-key'] as string) ?? '';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '{"score": 3.5, "rationale": "partial"}' }],
          stop_reason: 'end_turn',
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('judgeWithAnthropic', () => {
  it('sends x-api-key and parses content[].text', async () => {
    const r = await judgeWithAnthropic({
      baseUrl,
      apiKey: 'sk-test',
      model: 'claude-opus-4-7',
      temperature: 0,
      maxTokens: 256,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(receivedAuth).toBe('sk-test');
    expect(r.score).toBe(3.5);
    expect(r.rationale).toBe('partial');
  });
});
