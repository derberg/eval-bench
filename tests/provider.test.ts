import { describe, it, expect } from 'vitest';
import { chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { invokeClaude } from '../src/provider.js';

const fakeClaude = resolve('tests/fixtures/fake-claude.js');
chmodSync(fakeClaude, 0o755);

describe('invokeClaude', () => {
  it('captures stdout and succeeds with exit 0', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaude],
      prompt: 'hello world',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
    });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('hello world');
    expect(r.output).toContain('/tmp/fake-plugin');
    expect(r.error).toBeNull();
    expect(r.durationMs).toBeGreaterThan(0);
  });

  it('records error and non-zero exit on timeout', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [resolve('tests/fixtures/hang.js')],
      prompt: 'x',
      pluginDir: '/tmp/x',
      timeoutMs: 200,
      model: null,
      allowedTools: null,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.error).toMatch(/timed out|killed|SIGTERM/i);
  });
});
