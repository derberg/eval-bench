import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { invokeClaude, parseStreamJson } from '../src/provider.js';

const fakeClaude = resolve('tests/fixtures/fake-claude.js');
const fakeClaudeJson = resolve('tests/fixtures/fake-claude-json.js');
const fakeClaudeCwd = resolve('tests/fixtures/fake-claude-cwd.js');
const fakeClaudePluginDir = resolve('tests/fixtures/fake-claude-plugin-dir.js');
const fakeClaudeMultiResult = resolve('tests/fixtures/fake-claude-multi-result.js');
chmodSync(fakeClaude, 0o755);
chmodSync(fakeClaudeJson, 0o755);
chmodSync(fakeClaudeCwd, 0o755);
chmodSync(fakeClaudePluginDir, 0o755);

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

  it('keeps every answer when the session resumes and emits several result events', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaudeMultiResult],
      prompt: 'x',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
      cwd: null,
    });
    expect(r.exitCode).toBe(0);
    // The judge must see what the user saw: both answers, in order. The empty
    // second result falls back to that segment's own assistant text.
    expect(r.output).toBe('First answer.\n\nFollow-up after the subagent returned.');
    // Tokens are per segment, so they add up; cost is cumulative, so the last wins.
    expect(r.usage).toEqual({
      inputTokens: 3,
      outputTokens: 30,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 3000,
      totalCostUsd: 0.8,
    });
    expect(r.toolCalls).toEqual([{ tool: 'TodoWrite', input: {} }]);
  });

  it('passes the plugin dir to the CLI via --plugin-dir (env var alone is invisible to claude)', async () => {
    const r = await invokeClaude({
      command: 'node',
      extraArgs: [fakeClaudePluginDir],
      prompt: 'hello plugin',
      pluginDir: '/tmp/fake-plugin',
      timeoutMs: 5000,
      model: null,
      allowedTools: null,
      cwd: null,
    });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain('[PLUGIN_DIR_FLAG=/tmp/fake-plugin]');
    expect(r.output).toContain('hello plugin');
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

describe('parseStreamJson', () => {
  const jsonl = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n');
  const init = { type: 'system', subtype: 'init' };
  const text = (t: string, parent: string | null = null) => ({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { content: [{ type: 'text', text: t }] },
  });
  const tool = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: {} }] } };
  const result = (r: unknown, cost: number, out: number, extra: Record<string, unknown> = {}) => ({
    type: 'result',
    result: r,
    total_cost_usd: cost,
    usage: { output_tokens: out },
    ...extra,
  });

  it('pairs each result with its own segment when the results arrive together at the end', () => {
    // The usual real layout: both segments run, then both result events follow.
    const p = parseStreamJson(
      jsonl(init, text('Seg1 answer'), tool, init, text('Seg2 answer'), result('', 1, 10), result('', 1, 5)),
    );
    expect(p?.output).toBe('Seg1 answer\n\nSeg2 answer');
  });

  it('ignores subagent text when falling back for an empty result', () => {
    const p = parseStreamJson(
      jsonl(init, text('Main answer'), text('Subagent report', 'toolu_1'), tool, result('', 1, 10)),
    );
    expect(p?.output).toBe('Main answer');
  });

  it('counts tokens and cost of a segment that ends in an error result', () => {
    const p = parseStreamJson(
      jsonl(
        init,
        text('Answer'),
        result('Answer', 1, 10),
        init,
        result(undefined, 2, 50, { subtype: 'error_max_turns', is_error: true }),
      ),
    );
    expect(p?.output).toBe('Answer');
    expect(p?.usage.outputTokens).toBe(60);
    expect(p?.usage.totalCostUsd).toBe(2);
  });

  it('returns null when no result carries text, so the caller falls back to raw stdout', () => {
    expect(
      parseStreamJson(jsonl(init, result(undefined, 2, 50, { subtype: 'error_max_turns', is_error: true }))),
    ).toBeNull();
  });
});
