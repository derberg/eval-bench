import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithGithubModels } from '../../src/judges/github-models.js';

let server: Server;
let baseUrl = '';
let receivedAuth = '';
let receivedPath = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    receivedAuth = (req.headers['authorization'] as string) ?? '';
    receivedPath = req.url ?? '';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            { message: { role: 'assistant', content: '{"score": 4.5, "rationale": "good"}' } },
          ],
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}/inference`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('judgeWithGithubModels', () => {
  it('POSTs to /chat/completions with Bearer token and parses JSON', async () => {
    const r = await judgeWithGithubModels({
      endpoint: baseUrl,
      apiKey: 'ghp_test',
      model: 'openai/gpt-4o',
      temperature: 0,
      maxTokens: 256,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(receivedAuth).toBe('Bearer ghp_test');
    expect(receivedPath).toBe('/inference/chat/completions');
    expect(r.score).toBe(4.5);
    expect(r.rationale).toBe('good');
  });
});
