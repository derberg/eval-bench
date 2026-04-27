import { describe, it, expect } from 'vitest';
import { chmodSync } from 'node:fs';
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
});
