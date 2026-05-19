import { writeFile, readdir, readFile, stat, mkdir, unlink, rm } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { execa } from 'execa';
import type {
  PromptSpec,
  Variant,
  Config,
  RunResult,
  Judgment,
  Snapshot,
  SummaryStats,
  TokenTotals,
} from './types.js';
import { invokeClaude } from './provider.js';
import { judge, judgeConfigFromConfig, type JudgeConfig } from './judges/index.js';
import { hashRubric } from './judges/rubric.js';
import { JudgeParseError } from './judges/parse.js';
import type { DebugLogger } from './debug.js';
import { noopDebug } from './debug.js';

interface CwdContext {
  snapshotsDir: string;
  snapshotName: string;
  variant: Variant;
  promptId: string;
  sample: number;
  pluginDir: string;
}

// Substitute the supported template variables in `provider.cwd`. Returns an
// absolute path or null if the template was explicitly set to null. Unknown
// {{vars}} pass through untouched so a typo surfaces as a directory name
// rather than silently substituting empty.
export function resolveCwd(template: string | null, ctx: CwdContext): string | null {
  if (!template) return null;
  const subs: Record<string, string> = {
    snapshots_dir: ctx.snapshotsDir,
    snapshot_name: ctx.snapshotName,
    variant: ctx.variant,
    prompt_id: ctx.promptId,
    sample: String(ctx.sample),
    plugin_dir: ctx.pluginDir,
  };
  const rendered = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(subs, name) ? subs[name] : match,
  );
  return resolvePath(rendered);
}

export interface MatrixRow {
  id: string;
  promptId: string;
  prompt: string;
  rubric: string;
  variant: Variant;
  sample: number;
}

export function expandMatrix(
  prompts: PromptSpec[],
  samples: number,
  variants: Variant[] = ['baseline', 'current'],
): MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const p of prompts) {
    for (const v of variants) {
      for (let s = 1; s <= samples; s++) {
        rows.push({
          id: `${p.id}::${v}::${s}`,
          promptId: p.id,
          prompt: p.prompt,
          rubric: p.rubric,
          variant: v,
          sample: s,
        });
      }
    }
  }
  return rows;
}

export interface RunBenchmarkOptions {
  config: Config;
  prompts: PromptSpec[];
  baselinePluginDir: string;
  currentPluginDir: string;
  baselineRef: string;
  baselineSha: string;
  currentRef: string;
  currentSha: string;
  name: string;
  // Restrict the matrix. Defaults to both variants. Use ['current'] for a
  // solo/baseline snapshot — baselinePluginDir/Ref/Sha can be empty strings
  // since they're never read when 'baseline' isn't in the matrix.
  variants?: Variant[];
  resume?: Snapshot | null;
  onCheckpoint?: (partial: Snapshot) => Promise<void>;
  onProgress?: (ev: ProgressEvent) => void;
  debug?: DebugLogger;
}

export type ProgressEvent =
  | { kind: 'matrix-built'; freshRows: number; reJudgeRows: number }
  | { kind: 'run-start'; rowId: string }
  | { kind: 'run-end'; rowId: string; durationMs: number; error: string | null }
  | { kind: 'judge-start'; runId: string }
  | {
      kind: 'judge-end';
      runId: string;
      score: number;
      rationale: string;
      error: string | null;
      durationMs: number;
    };

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

function stats(xs: number[]): SummaryStats {
  if (xs.length === 0) return { n: 0, mean: 0, median: 0, variance: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { n: xs.length, mean, median, variance };
}

function tokenTotals(runs: RunResult[]): TokenTotals {
  const totals: TokenTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalCostUsd: 0,
    reportedRuns: 0,
  };
  for (const r of runs) {
    if (!r.usage) continue;
    totals.inputTokens += r.usage.inputTokens;
    totals.outputTokens += r.usage.outputTokens;
    totals.cacheReadInputTokens += r.usage.cacheReadInputTokens;
    totals.cacheCreationInputTokens += r.usage.cacheCreationInputTokens;
    totals.totalCostUsd += r.usage.totalCostUsd;
    totals.reportedRuns += 1;
  }
  return totals;
}

function buildSnapshot(
  opts: RunBenchmarkOptions,
  runs: RunResult[],
  judgments: Judgment[],
  complete: boolean,
): Snapshot {
  const scoreOf = (runId: string): number =>
    judgments.find((j) => j.runId === runId)?.score ?? 0;
  const baselineScores = runs
    .filter((r) => r.variant === 'baseline')
    .map((r) => scoreOf(r.id));
  const currentScores = runs.filter((r) => r.variant === 'current').map((r) => scoreOf(r.id));
  const baseline = stats(baselineScores);
  const current = stats(currentScores);
  const baselineRuns = runs.filter((r) => r.variant === 'baseline');
  const currentRuns = runs.filter((r) => r.variant === 'current');
  const baselineTokens = tokenTotals(baselineRuns);
  const currentTokens = tokenTotals(currentRuns);
  // Only attach the tokens block if at least one run reported usage —
  // keeps snapshots tidy for non-Claude-CLI providers.
  const anyUsage = baselineTokens.reportedRuns > 0 || currentTokens.reportedRuns > 0;
  return {
    schemaVersion: 1,
    name: opts.name,
    createdAt: new Date().toISOString(),
    plugin: {
      path: opts.config.plugin.path,
      baselineRef: opts.baselineRef,
      baselineSha: opts.baselineSha,
      currentRef: opts.currentRef,
      currentSha: opts.currentSha,
    },
    config: opts.config,
    judge: { provider: opts.config.judge.provider, model: opts.config.judge.model },
    prompts: opts.prompts,
    runs,
    judgments,
    summary: {
      baseline,
      current,
      delta: current.mean - baseline.mean,
      ...(anyUsage && {
        tokens: {
          baseline: baselineTokens,
          current: currentTokens,
          costDelta: currentTokens.totalCostUsd - baselineTokens.totalCostUsd,
        },
      }),
    },
    complete,
  };
}

function shortHash(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

// Node's fetch wraps the underlying network error as TypeError("fetch failed")
// and stashes the actual reason on .cause. Without unwrapping, every transport
// failure shows up as the unhelpful "fetch failed". This walks the chain and
// returns the most specific message available.
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const parts: string[] = [e.message];
  let cur: unknown = (e as Error & { cause?: unknown }).cause;
  while (cur instanceof Error) {
    const code = (cur as Error & { code?: string }).code;
    parts.push(code ? `${cur.message} [${code}]` : cur.message);
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return parts.join(' → ');
}

const MAX_FILE_BYTES = 100_000;

async function collectRunFiles(cwd: string): Promise<string> {
  const sections: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(cwd, full);
        try {
          const s = await stat(full);
          if (s.size > MAX_FILE_BYTES) {
            sections.push(`--- FILE: ${rel} ---\n[file too large to include (${s.size} bytes)]\n---`);
            continue;
          }
          const content = await readFile(full, 'utf8');
          sections.push(`--- FILE: ${rel} ---\n${content}\n---`);
        } catch {
          // skip unreadable files
        }
      }
    }
  }
  await walk(cwd);
  return sections.join('\n\n');
}

// Extract files written by Claude from its tool calls. Write tool calls carry
// the full content inline; Edit tool calls carry only the patch, so we read the
// resulting file from disk. Deduplicated by path — last write wins.
async function collectToolCallFiles(toolCalls: RunResult['toolCalls']): Promise<string> {
  if (!toolCalls || toolCalls.length === 0) return '';
  const files = new Map<string, string>();
  for (const tc of toolCalls) {
    const inp = tc.input as Record<string, unknown>;
    const path = inp.file_path as string | undefined;
    if (!path) continue;
    if (tc.tool === 'Write' && typeof inp.content === 'string') {
      files.set(path, inp.content);
    } else if (tc.tool === 'Edit') {
      // Read the post-edit file from disk (best-effort).
      try {
        const s = await stat(path);
        if (s.size <= MAX_FILE_BYTES) {
          files.set(path, await readFile(path, 'utf8'));
        } else {
          files.set(path, `[file too large to include (${s.size} bytes)]`);
        }
      } catch {
        // file may have been deleted or moved — skip
      }
    }
  }
  if (files.size === 0) return '';
  return [...files.entries()]
    .map(([p, content]) => `--- FILE: ${p} ---\n${content}\n---`)
    .join('\n\n');
}

async function buildJudgeOutput(run: RunResult): Promise<string> {
  // First try tool calls — reliable regardless of where Claude wrote the files.
  const fromToolCalls = await collectToolCallFiles(run.toolCalls);
  if (fromToolCalls) {
    return `${run.output}\n\n=== Files written during run ===\n\n${fromToolCalls}`;
  }
  // Fall back to scanning the run cwd for files Claude may have created there.
  if (!run.cwd) return run.output;
  const fromCwd = await collectRunFiles(run.cwd);
  if (!fromCwd) return run.output;
  return `${run.output}\n\n=== Files written during run ===\n\n${fromCwd}`;
}

async function judgeRun(
  row: MatrixRow,
  run: RunResult,
  judgeCfg: JudgeConfig,
  onProgress: RunBenchmarkOptions['onProgress'],
  debug: DebugLogger,
): Promise<Judgment> {
  onProgress?.({ kind: 'judge-start', runId: row.id });
  const judgeStart = Date.now();
  let judgment: Judgment;
  if (run.error || run.output.length === 0) {
    judgment = {
      runId: run.id,
      score: 0,
      rationale: `run failed: ${run.error ?? 'empty output'}`,
      rubricHash: '',
      judgeProvider: judgeCfg.provider,
      judgeModel: judgeCfg.model,
      raw: '',
      error: 'run failed',
    };
    debug.event('judge-end', {
      rowId: row.id,
      score: 0,
      error: 'run failed',
    });
  } else {
    const judgeOutput = await buildJudgeOutput(run);
    const judgePromptBytes = row.prompt.length + judgeOutput.length + row.rubric.length;
    debug.event('judge-start', {
      rowId: row.id,
      provider: judgeCfg.provider,
      model: judgeCfg.model,
      promptBytes: judgePromptBytes,
      rubricHash: hashRubric(row.rubric),
    });
    try {
      const j = await judge(
        judgeCfg,
        { prompt: row.prompt, output: judgeOutput, rubric: row.rubric },
        debug,
      );
      judgment = {
        runId: run.id,
        score: j.score,
        rationale: j.rationale,
        rubricHash: j.rubricHash,
        judgeProvider: j.judgeProvider,
        judgeModel: j.judgeModel,
        raw: j.raw,
        error: null,
      };
      debug.event('judge-end', {
        rowId: row.id,
        score: j.score,
        rawBytes: j.raw.length,
        ...(j.ollamaTimings && { ollamaTimings: j.ollamaTimings }),
      });
    } catch (e) {
      const msg = describeError(e);
      // Parse failures discard the JSON candidate but the underlying judge
      // response is on the thrown error — keep it on the judgment so the
      // user can inspect what the model actually wrote.
      const rawOnError = e instanceof JudgeParseError ? e.raw : '';
      judgment = {
        runId: run.id,
        score: 0,
        rationale: `judge failed: ${msg}`,
        rubricHash: hashRubric(row.rubric),
        judgeProvider: judgeCfg.provider,
        judgeModel: judgeCfg.model,
        raw: rawOnError,
        error: msg,
      };
      debug.event('judge-end', { rowId: row.id, score: 0, error: msg });
    }
  }
  onProgress?.({
    kind: 'judge-end',
    runId: run.id,
    score: judgment.score,
    rationale: judgment.rationale,
    error: judgment.error,
    durationMs: Date.now() - judgeStart,
  });
  return judgment;
}

// Returns a snapshot of which paths are dirty (modified or untracked) in `dir`.
// Used to detect what Claude wrote so we can reset it after the run.
async function captureGitStatus(dir: string): Promise<Map<string, string>> {
  try {
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: dir });
    const map = new Map<string, string>();
    for (const line of stdout.split('\n').filter((l) => l.trim())) {
      const xy = line.slice(0, 2).trim();
      let p = line.slice(3).trim();
      // git quotes paths with special chars; strip surrounding quotes if present
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      map.set(join(dir, p), xy);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Reverts changes Claude made during a run. Only touches paths that were NOT
// dirty before the run (preserving any user-owned uncommitted changes).
// Tracked-file modifications are restored via `git checkout`; new untracked
// files/dirs are deleted outright.
async function resetClaudeWrites(dir: string, before: Map<string, string>): Promise<void> {
  const after = await captureGitStatus(dir);
  for (const [absPath, xy] of after) {
    if (before.has(absPath)) continue; // existed before the run — don't touch
    if (xy === '??' || xy === '?') {
      // Untracked file or directory Claude created — remove it
      const s = await stat(absPath).catch(() => null);
      if (s?.isDirectory()) {
        await rm(absPath, { recursive: true, force: true }).catch(() => {});
      } else {
        await unlink(absPath).catch(() => {});
      }
    } else {
      // Tracked file modified by Claude — restore to HEAD
      await execa('git', ['checkout', 'HEAD', '--', absPath], { cwd: dir }).catch(() => {});
    }
  }
}

async function runAndJudge(
  row: MatrixRow,
  opts: RunBenchmarkOptions,
  judgeCfg: JudgeConfig,
  debug: DebugLogger,
): Promise<{ run: RunResult; judgment: Judgment }> {
  opts.onProgress?.({ kind: 'run-start', rowId: row.id });
  const pluginDir =
    row.variant === 'baseline' ? opts.baselinePluginDir : opts.currentPluginDir;
  const absolutePluginDir = pluginDir ? resolvePath(pluginDir) : null;

  const artifactCwd = resolveCwd(opts.config.provider.cwd, {
    snapshotsDir: opts.config.snapshots.dir,
    snapshotName: opts.name,
    variant: row.variant,
    promptId: row.promptId,
    sample: row.sample,
    pluginDir,
  });

  // Snapshot git state before Claude runs so we can revert only the files
  // Claude touched — preserving any user-owned uncommitted changes.
  const beforeGitStatus = absolutePluginDir
    ? await captureGitStatus(absolutePluginDir)
    : new Map<string, string>();

  debug.event('run-start', {
    rowId: row.id,
    variant: row.variant,
    promptId: row.promptId,
    sample: row.sample,
    promptHash: shortHash(row.prompt),
    cwd: artifactCwd,
  });

  try {
    const r = await invokeClaude({
      command: opts.config.provider.command,
      extraArgs: opts.config.provider.extraArgs,
      prompt: row.prompt,
      pluginDir,
      timeoutMs: opts.config.provider.timeout * 1000,
      model: opts.config.provider.model,
      allowedTools: opts.config.provider.allowedTools,
      cwd: artifactCwd,
      debug,
    });
    opts.onProgress?.({
      kind: 'run-end',
      rowId: row.id,
      durationMs: r.durationMs,
      error: r.error,
    });

    for (const tc of r.toolCalls ?? []) {
      debug.event('tool-call', { rowId: row.id, tool: tc.tool, input: JSON.stringify(tc.input) });
    }

    let transcriptFile: string | null = null;
    if (r.rawTranscript && artifactCwd) {
      await mkdir(artifactCwd, { recursive: true });
      const tPath = join(artifactCwd, 'transcript.jsonl');
      await writeFile(tPath, r.rawTranscript);
      const snapshotDir = realpathSync(resolvePath(opts.config.snapshots.dir, opts.name));
      transcriptFile = relative(snapshotDir, tPath);
    }

    debug.event('run-end', {
      rowId: row.id,
      exitCode: r.exitCode,
      durationMs: r.durationMs,
      outputBytes: r.output.length,
      toolCallCount: r.toolCalls?.length ?? 0,
      transcriptFile,
      ...(r.usage && {
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
      }),
      ...(r.error && { error: r.error }),
    });
    const run: RunResult = {
      id: row.id,
      promptId: row.promptId,
      variant: row.variant,
      sample: row.sample,
      output: r.output,
      durationMs: r.durationMs,
      exitCode: r.exitCode,
      error: r.error,
      usage: r.usage,
      cwd: artifactCwd ?? r.cwd,
      toolCalls: r.toolCalls,
      transcriptFile,
    };
    const judgment = await judgeRun(row, run, judgeCfg, opts.onProgress, debug);
    return { run, judgment };
  } finally {
    // After judging (so judge can still read files from disk), revert what
    // Claude wrote so the next sample starts with a clean plugin directory.
    if (absolutePluginDir) {
      await resetClaudeWrites(absolutePluginDir, beforeGitStatus).catch(() => {});
    }
  }
}

export async function runBenchmark(opts: RunBenchmarkOptions): Promise<Snapshot> {
  const debug = opts.debug ?? noopDebug();
  const matrix = expandMatrix(opts.prompts, opts.config.runs.samples, opts.variants);
  const judgeCfg = judgeConfigFromConfig(opts.config);

  const runs: RunResult[] = opts.resume?.runs ? [...opts.resume.runs] : [];
  const judgments: Judgment[] = opts.resume?.judgments ? [...opts.resume.judgments] : [];
  const runsById = new Map(runs.map((r) => [r.id, r]));
  const judgmentById = new Map(judgments.map((j) => [j.runId, j]));

  const fresh: MatrixRow[] = [];
  const rejudge: MatrixRow[] = [];
  for (const row of matrix) {
    const existingRun = runsById.get(row.id);
    const existingJudgment = judgmentById.get(row.id);
    if (!existingRun) {
      fresh.push(row);
    } else if (
      existingRun.error === null &&
      existingRun.output.length === 0 &&
      existingJudgment?.error === 'run failed'
    ) {
      // Run exited cleanly but produced empty output (e.g. agent ended on a
      // trailing tool call). Re-invoke Claude rather than re-judging empty output.
      fresh.push(row);
    } else if (
      existingRun.error === null &&
      existingRun.output.length > 0 &&
      (!existingJudgment ||
        (typeof existingJudgment.error === 'string' && existingJudgment.error !== 'run failed'))
    ) {
      // Run succeeded; judge either errored or was deliberately stripped
      // (e.g. via `eb run --rejudge`). Either way, judge fresh — no Claude call.
      rejudge.push(row);
    }
    // else: row is fully done (or run itself failed) — skip.
  }

  debug.event('matrix-built', {
    rows: matrix.length,
    variants: opts.variants ?? ['baseline', 'current'],
    samples: opts.config.runs.samples,
    freshRows: fresh.length,
    reJudgeRows: rejudge.length,
    parallel: opts.config.runs.parallel,
  });
  opts.onProgress?.({
    kind: 'matrix-built',
    freshRows: fresh.length,
    reJudgeRows: rejudge.length,
  });

  // Serialize checkpoint writes so concurrent rows don't corrupt the file.
  let writeChain: Promise<void> = Promise.resolve();
  const checkpoint = async (): Promise<void> => {
    if (!opts.onCheckpoint) return;
    const snap = buildSnapshot(opts, runs, judgments, false);
    writeChain = writeChain.then(() => opts.onCheckpoint!(snap));
    await writeChain;
    debug.event('checkpoint', {
      runs: snap.runs.length,
      judgments: snap.judgments.length,
      complete: false,
    });
  };

  // Re-judge first: cheap, no Claude invocations.
  await mapWithConcurrency(rejudge, opts.config.runs.parallel, async (row) => {
    const cachedRun = runsById.get(row.id)!;
    const newJudgment = await judgeRun(row, cachedRun, judgeCfg, opts.onProgress, debug);
    const idx = judgments.findIndex((j) => j.runId === row.id);
    if (idx >= 0) judgments[idx] = newJudgment;
    else judgments.push(newJudgment);
    await checkpoint();
  });

  await mapWithConcurrency(fresh, opts.config.runs.parallel, async (row) => {
    const { run, judgment } = await runAndJudge(row, opts, judgeCfg, debug);
    runs.push(run);
    judgments.push(judgment);
    await checkpoint();
  });

  return buildSnapshot(opts, runs, judgments, true);
}
