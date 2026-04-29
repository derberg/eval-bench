import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { judgeWithOllama } from '../../src/judges/ollama.js';

let server: Server;
let baseUrl = '';
let mode: 'happy' | 'split' | 'error' = 'happy';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (mode === 'error') {
        res.end(JSON.stringify({ error: 'model not found' }) + '\n');
        return;
      }
      // Stream the rationale across multiple chunks; final chunk has done:true
      // with Ollama's diagnostic timing fields.
      const fullJson = '{"score": 4.5, "rationale": "covers all points"}';
      const chunks: string[] = [];
      if (mode === 'split') {
        const half = Math.floor(fullJson.length / 2);
        chunks.push(JSON.stringify({ message: { content: fullJson.slice(0, half) } }));
        chunks.push(JSON.stringify({ message: { content: fullJson.slice(half) } }));
      } else {
        chunks.push(JSON.stringify({ message: { content: fullJson } }));
      }
      chunks.push(
        JSON.stringify({
          done: true,
          prompt_eval_count: 512,
          prompt_eval_duration: 1_000_000_000,
          eval_count: 32,
          eval_duration: 4_000_000_000,
          total_duration: 5_000_000_000,
        }),
      );
      res.end(chunks.map((c) => c + '\n').join(''));
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
  it('parses an NDJSON stream and returns score, rationale, raw, timings', async () => {
    mode = 'happy';
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
    expect(r.timings).toEqual({
      promptEvalCount: 512,
      promptEvalMs: 1000,
      evalCount: 32,
      evalMs: 4000,
      totalMs: 5000,
    });
  });

  it('accumulates content split across chunks', async () => {
    mode = 'split';
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
  });

  it('throws when stream contains an error chunk', async () => {
    mode = 'error';
    await expect(
      judgeWithOllama({
        endpoint: baseUrl,
        model: 'qwen2.5:14b',
        temperature: 0,
        maxTokens: 256,
        prompt: 'list products',
        output: 'A, B, C',
        rubric: 'score 0-5',
      }),
    ).rejects.toThrow(/model not found/);
  });
});
