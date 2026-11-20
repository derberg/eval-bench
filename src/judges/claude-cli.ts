import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';

export interface ClaudeCliJudgeOptions {
  command?: string;
  extraArgs?: string[];
  // Start the judge without user plugins, MCP servers, or hooks (default true).
  isolation?: boolean;
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
  // The judge is a pure {prompt, output, rubric} scorer and needs no plugins,
  // MCP servers, or hooks. The temp cwd below keeps project settings out, but
  // user-scope plugins in ~/.claude still load, and a user plugin's Stop hook
  // replaces the JSON verdict with its own message (CENNSO-4548). The plugins
  // built into Claude Code (`cc-plugin-*@builtin`) still load.
  // A --setting-sources in extraArgs wins, for a judge that needs `env` or
  // `apiKeyHelper` from the user settings to reach its model.
  const extraArgs = opts.extraArgs ?? [];
  const isolation = opts.isolation ?? true;
  // The same goes for a --settings there, because a second --settings would
  // compete with it.
  const has = (flag: string) => extraArgs.some((a) => a === flag || a.startsWith(`${flag}=`));
  const isolationArgs = isolation
    ? [
        ...(has('--setting-sources') ? [] : ['--setting-sources', '']),
        '--strict-mcp-config',
        ...(has('--settings') ? [] : ['--settings', JSON.stringify({ disableAllHooks: true })]),
      ]
    : [];
  const args = [...extraArgs, ...isolationArgs, '-p', judgePrompt];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  // Judge from a neutral temp cwd, never the caller's, so the benchmarked
  // repo's project context (CLAUDE.md, project hooks) stays out of the call.
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
      // claude.ai connectors come from the account, not from settings files,
      // so --setting-sources and --strict-mcp-config leave them loaded.
      env:
        isolation && process.env.ENABLE_CLAUDEAI_MCP_SERVERS === undefined
          ? { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' }
          : process.env,
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
