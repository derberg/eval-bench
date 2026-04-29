import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { initDebug, noopDebug } from '../src/debug.js';

let scratch = '';
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'eb-debug-'));
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/stream') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        res.write('{"chunk":1}\n');
        res.write('{"chunk":2}\n');
        res.end('{"done":true}\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, echoed: body.length }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
  await new Promise<void>((r) => server.close(() => r()));
});

describe('noopDebug', () => {
  it('passes through fetch and returns body text without writing anything', async () => {
    const debug = noopDebug();
    expect(debug.enabled).toBe(false);
    expect(debug.logFile).toBeNull();
    const { res, bodyText } = await debug.fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: '{"hello":"world"}',
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(bodyText);
    expect(parsed.ok).toBe(true);
    await debug.close();
  });
});

describe('initDebug', () => {
  it('writes events and HTTP exchanges to a per-invocation file with secrets redacted', async () => {
    const fixedNow = new Date('2026-04-29T10:00:00.000Z');
    const debug = await initDebug({
      snapshotDir: scratch,
      name: 'snap-a',
      now: () => fixedNow,
    });
    expect(debug.logFile).toMatch(/snap-a\/debug-2026-04-29T10-00-00-000Z\.log$/);

    debug.event('config-loaded', { judgeProvider: 'ollama', maxTokens: 1024 });

    const { res, bodyText } = await debug.fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      body: '{"hello":"world"}',
    });
    expect(res.status).toBe(200);
    expect(bodyText).toContain('"ok":true');

    await debug.close();

    const log = await readFile(debug.logFile!, 'utf8');
    expect(log).toContain('[config-loaded]');
    expect(log).toContain('judgeProvider=ollama');
    expect(log).toContain('[http-req]');
    expect(log).toContain('[http-res]');
    expect(log).toContain('status=200');
    expect(log).toContain('<redacted>');
    expect(log).not.toContain('Bearer secret');
    expect(log).toContain('"hello":"world"');
  });

  it('captures streamed chunks and emits at least one http-chunk event', async () => {
    const debug = await initDebug({
      snapshotDir: scratch,
      name: 'snap-stream',
      now: () => new Date('2026-04-29T10:01:00.000Z'),
    });
    const lines: string[] = [];
    const { bodyText } = await debug.fetch(
      `${baseUrl}/stream`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { expectStream: true, onStreamLine: (line) => lines.push(line) },
    );
    expect(lines.length).toBe(3);
    expect(bodyText).toContain('"chunk":1');
    expect(bodyText).toContain('"done":true');
    await debug.close();
    const log = await readFile(debug.logFile!, 'utf8');
    expect(log).toContain('[http-chunk]');
    expect(log).toContain('chunkCount=');
  });
});
