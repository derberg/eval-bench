import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';

export interface ClaudeCliJudgeOptions {
  command?: string;
  extraArgs?: string[];
  model: string | null;
  timeoutMs?: number;
  prompt: string;
  output: string;
  rubric: string;
  template?: string | null;
}

export async function judgeWithClaudeCli(
  opts: ClaudeCliJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const judgePrompt = buildJudgePrompt({
    prompt: opts.prompt,
    output: opts.output,
    rubric: opts.rubric,
    template: opts.template,
  });
  const args = [...(opts.extraArgs ?? []), '-p', judgePrompt];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  // Judge from a neutral temp cwd, never the caller's. Inheriting the cwd
  // starts the judge session inside the benchmarked repo, where project
  // context leaks into the call — most destructively Stop hooks (e.g. from an
  // installed plugin), which fire after the verdict and replace the final
  // message, so stdout is hook prose instead of the JSON verdict. A non-git
  // temp dir keeps the judge a pure {prompt, output, rubric} scorer.
  const cwd = await mkdtemp(join(tmpdir(), 'eb-judge-'));
  let result;
  try {
    result = await execa(opts.command ?? 'claude', args, {
      cwd,
      timeout: opts.timeoutMs ?? 180_000,
      reject: false,
      // The judge prompt is passed via -p; nothing else needs to be piped.
      // Without an explicit `ignore` here, execa defaults to `pipe`, which
      // claude CLI treats as "stdin is going to arrive" — it waits ~3s then
      // emits a warning + exits non-zero, breaking the judge call entirely.
      stdin: 'ignore',
    });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  }
  if (result.timedOut) {
    throw new Error('claude-cli: judge timed out');
  }
  if (result.exitCode !== 0) {
    const detail = (result.stderr || result.stdout || '').toString().slice(0, 500);
    throw new Error(`claude-cli: exit ${result.exitCode}: ${detail}`);
  }
  const raw = (result.stdout ?? '').toString();
  const parsed = parseJudgeResponse(raw);
  return { ...parsed, raw };
}
