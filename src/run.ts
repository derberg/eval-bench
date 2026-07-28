import { writeFile, readdir, readFile, stat, mkdir, unlink, rm, mkdtemp } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve as resolvePath, join, relative, dirname, isAbsolute, sep, basename } from 'node:path';
import { tmpdir } from 'node:os';
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

// A resumed snapshot may cover more prompts than this run's (possibly
// --only-filtered) matrix. Preserve the existing prompt list, updating the
// definitions of the prompts this run actually executed and appending any new
// ones — otherwise a filtered --refresh / --retry-failed / --rejudge clobbers
// the snapshot's prompt list and the HTML view renders only the filtered
// subset even though runs/judgments still hold every row.
export function mergePrompts(
  existing: PromptSpec[] | undefined,
  ran: PromptSpec[],
): PromptSpec[] {
  if (!existing?.length) return ran;
  const ranById = new Map(ran.map((p) => [p.id, p]));
  const have = new Set(existing.map((p) => p.id));
  return [
    ...existing.map((p) => ranById.get(p.id) ?? p),
    ...ran.filter((p) => !have.has(p.id)),
  ];
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
    prompts: mergePrompts(opts.resume?.prompts, opts.prompts),
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

// Saves files Claude wrote to the plugin dir (via absolute paths) into destDir.
// Write tool calls carry content inline; Edit calls are read from disk — call
// this before the post-run git cleanup reverts the project directory.
// Relative-path writes (which land in Claude's cwd) are handled separately
// by copyDirToOutput.
async function saveToolCallOutputs(
  toolCalls: RunResult['toolCalls'],
  pluginDir: string,
  destDir: string,
): Promise<void> {
  if (!toolCalls || toolCalls.length === 0) return;
  const absPlugin = resolvePath(pluginDir);
  const files = new Map<string, string>();
  for (const tc of toolCalls) {
    const inp = tc.input as Record<string, unknown>;
    const rawPath = inp.file_path as string | undefined;
    if (!rawPath || !isAbsolute(rawPath)) continue; // relative paths handled via cwd scan
    const abs = resolvePath(rawPath);
    let rel = relative(absPlugin, abs);
    if (rel.startsWith('..') || rel === '') {
      // outside plugin dir — capture anyway, using path relative to fs root
      rel = abs.replace(/^\/+/, '');
    }
    if (tc.tool === 'Write' && typeof inp.content === 'string') {
      files.set(rel, inp.content as string);
    } else if (tc.tool === 'Edit') {
      try {
        const s = await stat(abs);
        if (s.size <= MAX_FILE_BYTES) {
          files.set(rel, await readFile(abs, 'utf8'));
        }
      } catch {
        // file may have been deleted or moved — skip
      }
    }
  }
  for (const [rel, content] of files) {
    const dest = join(destDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content, 'utf8');
  }
}

// Recursively copies all files from srcDir into destDir, mirroring the
// directory structure. Used to capture files Claude wrote with relative paths
// (which land in its isolated cwd) into the persistent artifact dir.
async function copyDirToOutput(srcDir: string, destDir: string): Promise<void> {
  const entries = await readdir(srcDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirToOutput(src, dest);
    } else if (entry.isFile()) {
      try {
        const s = await stat(src);
        if (s.size > MAX_FILE_BYTES) continue;
        const content = await readFile(src, 'utf8');
        await mkdir(destDir, { recursive: true });
        await writeFile(dest, content, 'utf8');
      } catch {
        // skip unreadable files
      }
    }
  }
}

async function buildJudgeOutput(run: RunResult): Promise<string> {
  if (!run.cwd) return run.output;
  // Read from the per-sample output dir populated by saveToolCallOutputs.
  const files = await collectRunFiles(join(run.cwd, 'output'));
  if (!files) return run.output;
  return `${run.output}\n\n=== Files written during run ===\n\n${files}`;
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

// Reverts any absolute-path Write/Edit tool calls Claude made to locations
// outside both claudeCwd (already deleted) and absolutePluginDir (handled by
// resetClaudeWrites). Tries git-checkout first; falls back to unlink for
// newly-created untracked files.
async function undoExternalWrites(
  toolCalls: RunResult['toolCalls'],
  claudeCwd: string,
  absolutePluginDir: string | null,
): Promise<void> {
  if (!toolCalls || toolCalls.length === 0) return;
  const targets = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.tool !== 'Write' && tc.tool !== 'Edit') continue;
    const inp = tc.input as Record<string, unknown>;
    const rawPath = inp.file_path as string | undefined;
    if (!rawPath || !isAbsolute(rawPath)) continue;
    const abs = resolvePath(rawPath);
    const inCwd = abs === claudeCwd || abs.startsWith(claudeCwd + sep);
    const inPlugin = absolutePluginDir && (abs === absolutePluginDir || abs.startsWith(absolutePluginDir + sep));
    if (!inCwd && !inPlugin) targets.add(abs);
  }
  for (const abs of targets) {
    // Try git restore (works for tracked files that were modified or newly added)
    try {
      await execa('git', ['-C', dirname(abs), 'checkout', 'HEAD', '--', basename(abs)]);
      continue;
    } catch {
      // not a git-tracked file — fall through
    }
    // For untracked new files created by Claude, delete them
    await unlink(abs).catch(() => {});
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

  // artifactCwd: persisted per-sample dir inside the snapshot tree (for
  // transcript, output files, and run.cwd stored in the snapshot).
  const artifactCwd = resolveCwd(opts.config.provider.cwd, {
    snapshotsDir: opts.config.snapshots.dir,
    snapshotName: opts.name,
    variant: row.variant,
    promptId: row.promptId,
    sample: row.sample,
    pluginDir,
  });
  // claudeCwd: fresh isolated temp dir for this sample only. Claude runs here
  // so it cannot navigate to sibling sample dirs inside the snapshot tree.
  // When provider.cwd is explicitly null (artifactCwd null), the legacy
  // contract applies instead: the provider inherits this process's cwd, so
  // relative commands/args keep resolving against it.
  const claudeCwd = artifactCwd === null ? null : await mkdtemp(join(tmpdir(), 'eb-run-'));

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
    cwd: claudeCwd,
  });

  let lastToolCalls: RunResult['toolCalls'] = [];
  try {
    const r = await invokeClaude({
      command: opts.config.provider.command,
      extraArgs: opts.config.provider.extraArgs,
      prompt: row.prompt,
      pluginDir,
      timeoutMs: opts.config.provider.timeout * 1000,
      model: opts.config.provider.model,
      allowedTools: opts.config.provider.allowedTools,
      cwd: claudeCwd,
      debug,
    });
    opts.onProgress?.({
      kind: 'run-end',
      rowId: row.id,
      durationMs: r.durationMs,
      error: r.error,
    });

    lastToolCalls = r.toolCalls ?? [];
    for (const tc of lastToolCalls) {
      debug.event('tool-call', { rowId: row.id, tool: tc.tool, input: JSON.stringify(tc.input) });
    }

    const outputDir = artifactCwd ? join(artifactCwd, 'output') : null;
    let transcriptFile: string | null = null;
    if (artifactCwd) {
      await mkdir(artifactCwd, { recursive: true });
      if (r.rawTranscript) {
        const tPath = join(artifactCwd, 'transcript.jsonl');
        await writeFile(tPath, r.rawTranscript);
        const snapshotDir = realpathSync(resolvePath(opts.config.snapshots.dir, opts.name));
        transcriptFile = relative(snapshotDir, tPath);
      }
      if (outputDir && claudeCwd) {
        // Copy relative-path writes (landed in claudeCwd) into output/.
        await copyDirToOutput(claudeCwd, outputDir).catch(() => {});
        // Save absolute-path writes to pluginDir into output/ before git cleanup.
        if (pluginDir) {
          await saveToolCallOutputs(r.toolCalls, pluginDir, outputDir).catch(() => {});
        }
      }
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
      cwd: artifactCwd,
      toolCalls: r.toolCalls,
      transcriptFile,
    };
    const judgment = await judgeRun(row, run, judgeCfg, opts.onProgress, debug);
    return { run, judgment };
  } finally {
    // Delete the isolated claudeCwd — artifacts already saved to artifactCwd.
    // In legacy mode (claudeCwd null) the provider ran in this process's cwd,
    // which must never be deleted.
    if (claudeCwd) {
      await rm(claudeCwd, { recursive: true, force: true }).catch(() => {});
    }
    // Revert what Claude wrote to the plugin dir so the next sample starts clean.
    if (absolutePluginDir) {
      await resetClaudeWrites(absolutePluginDir, beforeGitStatus).catch(() => {});
    }
    // Revert any writes Claude made to locations outside both claudeCwd and
    // pluginDir (e.g. writing to an unrelated repo or /tmp path). In legacy
    // mode the provider's working area is this process's cwd — treat it as
    // the cwd so its own relative-area writes are not reverted.
    await undoExternalWrites(lastToolCalls, claudeCwd ?? process.cwd(), absolutePluginDir).catch(
      () => {},
    );
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
