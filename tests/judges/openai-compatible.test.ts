import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithOpenAICompatible } from '../../src/judges/openai-compatible.js';

let server: Server;
let baseUrl = '';
let lastBody: { model: string; temperature: number; max_tokens: number } | null = null;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      lastBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            { message: { role: 'assistant', content: '{"score": 4, "rationale": "good"}' } },
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

describe('judgeWithOpenAICompatible', () => {
  it('POSTs to /chat/completions with temperature and model', async () => {
    const r = await judgeWithOpenAICompatible({
      endpoint: baseUrl,
      apiKey: 'x',
      model: 'mistral-7b',
      temperature: 0.2,
      maxTokens: 128,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(r.score).toBe(4);
    expect(lastBody!.model).toBe('mistral-7b');
    expect(lastBody!.temperature).toBe(0.2);
    expect(lastBody!.max_tokens).toBe(128);
  });

  it('works without apiKey (local endpoints like llama.cpp server)', async () => {
    const r = await judgeWithOpenAICompatible({
      endpoint: baseUrl,
      apiKey: null,
      model: 'local',
      temperature: 0,
      maxTokens: 128,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(r.score).toBe(4);
  });
});
