import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithOllama } from '../../src/judges/ollama.js';

let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const reqJson = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: reqJson.model,
          message: {
            role: 'assistant',
            content: '{"score": 4.5, "rationale": "covers all points"}',
          },
          done: true,
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

describe('judgeWithOllama', () => {
  it('calls /api/chat and parses the response', async () => {
    const r = await judgeWithOllama({
      endpoint: baseUrl,
      model: 'qwen2.5:14b',
      temperature: 0,
      maxTokens: 256,
      prompt: 'list products',
      output: 'A, B, C',
      rubric: 'score 0-5',
    });
    expect(r.score).toBe(4.5);
    expect(r.rationale).toBe('covers all points');
    expect(r.raw).toContain('"score"');
  });
});
