import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { invokeClaude } from '../src/provider.js';

const fakeClaude = resolve('tests/fixtures/fake-claude.js');
const fakeClaudeJson = resolve('tests/fixtures/fake-claude-json.js');
const fakeClaudeCwd = resolve('tests/fixtures/fake-claude-cwd.js');
chmodSync(fakeClaude, 0o755);
chmodSync(fakeClaudeJson, 0o755);
chmodSync(fakeClaudeCwd, 0o755);

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
      cwd: null,
    });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('hello world');
    expect(r.output).toContain('/tmp/fake-plugin');
    expect(r.error).toBeNull();
    expect(r.durationMs).toBeGreaterThan(0);
    // Plain-text providers (non-JSON) should report no usage rather than fail.
    expect(r.usage).toBeNull();
  });

  it('extracts usage from claude --output-format json envelope', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaudeJson],
      prompt: 'hello world',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
      cwd: null,
    });
    expect(r.exitCode).toBe(0);
    // `result` is unwrapped — judge sees the model output, not the JSON envelope.
    expect(r.output).toBe('[PLUGIN_DIR=/tmp/fake-plugin] hello world');
    expect(r.usage).toEqual({
      inputTokens: 11,
      outputTokens: 22,
      cacheReadInputTokens: 33,
      cacheCreationInputTokens: 44,
      totalCostUsd: 0.0123,
    });
  });

  it('spawns the provider in opts.cwd, creating the directory if missing, and returns the canonical path', async () => {
    const base = mkdtempSync(join(tmpdir(), 'ef-cwd-'));
    const target = join(base, 'nested', 'workdir');
    expect(existsSync(target)).toBe(false);
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaudeCwd],
      prompt: 'hi',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
      cwd: target,
    });
    expect(r.exitCode).toBe(0);
    // Result.cwd is canonical (realpath-resolved), matching what the child's
    // process.cwd() reports — important on macOS where /var/folders is a
    // symlink to /private/var/folders.
    const canonical = realpathSync(target);
    expect(r.cwd).toBe(canonical);
    expect(r.output).toContain(`[CWD=${canonical}]`);
    // The fake provider drops a file at cwd; if execa honored cwd, the file
    // lands there.
    expect(readFileSync(join(target, 'artifact.txt'), 'utf8')).toContain('prompt=hi');
  });

  it('reports cwd: null when no cwd is configured', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaude],
      prompt: 'noop',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
      cwd: null,
    });
    expect(r.exitCode).toBe(0);
    expect(r.cwd).toBeNull();
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
      cwd: null,
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.error).toMatch(/timed out|killed|SIGTERM/i);
  });
});
