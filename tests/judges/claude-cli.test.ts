import { describe, it, expect } from 'vitest';
import { chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { judgeWithClaudeCli } from '../../src/judges/claude-cli.js';

const fakeJudge = resolve('tests/fixtures/fake-claude-judge.js');
chmodSync(fakeJudge, 0o755);

describe('judgeWithClaudeCli', () => {
  it('spawns the command, parses JSON from stdout', async () => {
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [fakeJudge],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(r.score).toBe(4);
    expect(r.rationale).toBe('looks fine');
  });

  it('throws on timeout', async () => {
    const hang = resolve('tests/fixtures/hang.js');
    await expect(
      judgeWithClaudeCli({
        command: 'node',
        extraArgs: [hang],
        model: null,
        timeoutMs: 200,
        prompt: 'p',
        output: 'o',
        rubric: 'r',
      }),
    ).rejects.toThrow(/timed out|killed|SIGTERM/i);
  });

  it('throws on non-zero exit', async () => {
    const exiter = resolve('tests/fixtures/exit-with-code.js');
    chmodSync(exiter, 0o755);
    await expect(
      judgeWithClaudeCli({
        command: 'node',
        extraArgs: [exiter, '7'],
        model: null,
        timeoutMs: 5000,
        prompt: 'p',
        output: 'o',
        rubric: 'r',
      }),
    ).rejects.toThrow(/exit 7/);
  });

  it('runs the judge from a neutral temp cwd, not the caller cwd', async () => {
    // Inheriting the caller's cwd puts the judge session inside the
    // benchmarked repo, where project context (e.g. plugin Stop hooks) can
    // replace the judge's final message and destroy the JSON verdict.
    const cwdJudge = resolve('tests/fixtures/fake-claude-judge-cwd.js');
    chmodSync(cwdJudge, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [cwdJudge],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(r.rationale).not.toBe(process.cwd());
    expect(r.rationale).toContain('eb-judge-');
    expect(existsSync(r.rationale)).toBe(false); // temp cwd is removed afterwards
  });

  it('does not pipe stdin to the judge process — child sees EOF immediately', async () => {
    // Real claude CLI warns + exits non-zero when stdin is left open as a
    // pipe with no data ("Warning: no stdin data received in 3s, proceeding
    // without it"). The fixture mirrors that contract: it succeeds only when
    // stdin closes promptly.
    const stdinDetect = resolve('tests/fixtures/fake-claude-stdin-detect.js');
    chmodSync(stdinDetect, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [stdinDetect],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    expect(r.score).toBe(4);
    expect(r.rationale).toBe('stdin-eof-received');
  });
  it('starts the judge isolated: no user/project settings, no MCP servers, no hooks, no claude.ai connectors', async () => {
    // A temp cwd keeps project hooks out, but user-scope plugins in ~/.claude
    // still load. A user plugin's Stop hook then replaces the JSON verdict
    // with its own message (CENNSO-4548). The judge needs no plugins at all.
    const argsJudge = resolve('tests/fixtures/fake-claude-judge-args.js');
    chmodSync(argsJudge, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [argsJudge],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    const seen = JSON.parse(r.rationale) as { args: string[]; claudeAiMcp: string | null };
    const i = seen.args.indexOf('--setting-sources');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(seen.args[i + 1]).toBe('');
    expect(seen.args).toContain('--strict-mcp-config');
    const s = seen.args.indexOf('--settings');
    expect(JSON.parse(seen.args[s + 1])).toEqual({ disableAllHooks: true });
    expect(seen.claudeAiMcp).toBe('false');
  });
  it('keeps a --settings from extraArgs instead of adding its own', async () => {
    const argsJudge = resolve('tests/fixtures/fake-claude-judge-args.js');
    chmodSync(argsJudge, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [argsJudge, '--settings', 'mine.json'],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    const seen = JSON.parse(r.rationale) as { args: string[] };
    expect(seen.args.filter((a) => a === '--settings')).toHaveLength(1);
    expect(seen.args).toContain('mine.json');
  });

  it('isolation: false starts the judge without isolation flags', async () => {
    const argsJudge = resolve('tests/fixtures/fake-claude-judge-args.js');
    chmodSync(argsJudge, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [argsJudge],
      isolation: false,
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    const seen = JSON.parse(r.rationale) as { args: string[]; claudeAiMcp: string | null };
    expect(seen.args).not.toContain('--setting-sources');
    expect(seen.args).not.toContain('--strict-mcp-config');
    expect(seen.args).not.toContain('--settings');
  });

  it('keeps the user --setting-sources from extraArgs and still blocks MCP servers and hooks', async () => {
    const argsJudge = resolve('tests/fixtures/fake-claude-judge-args.js');
    chmodSync(argsJudge, 0o755);
    const r = await judgeWithClaudeCli({
      command: 'node',
      extraArgs: [argsJudge, '--setting-sources=user'],
      model: null,
      timeoutMs: 5000,
      prompt: 'p',
      output: 'o',
      rubric: 'r',
    });
    const seen = JSON.parse(r.rationale) as { args: string[] };
    expect(seen.args).not.toContain('--setting-sources');
    expect(seen.args).toContain('--setting-sources=user');
    expect(seen.args).toContain('--strict-mcp-config');
  });

});
