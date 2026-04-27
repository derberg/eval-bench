import { execa } from 'execa';
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
}

export async function judgeWithClaudeCli(
  opts: ClaudeCliJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const judgePrompt = buildJudgePrompt(opts);
  const args = [...(opts.extraArgs ?? []), '-p', judgePrompt];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  const result = await execa(opts.command ?? 'claude', args, {
    timeout: opts.timeoutMs ?? 180_000,
    reject: false,
  });
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
