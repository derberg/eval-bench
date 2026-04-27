import type {
  PromptSpec,
  Variant,
  Config,
  RunResult,
  Judgment,
  Snapshot,
  SummaryStats,
} from './types.js';
import { invokeClaude } from './provider.js';
import { judge, judgeConfigFromConfig } from './judges/index.js';

export interface MatrixRow {
  id: string;
  promptId: string;
  prompt: string;
  rubric: string;
  variant: Variant;
  sample: number;
}

export function expandMatrix(prompts: PromptSpec[], samples: number): MatrixRow[] {
  const rows: MatrixRow[] = [];
  const variants: Variant[] = ['baseline', 'current'];
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
  onProgress?: (ev: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: 'run-start'; rowId: string }
  | { kind: 'run-end'; rowId: string; durationMs: number; error: string | null }
  | { kind: 'judge-start'; runId: string }
  | { kind: 'judge-end'; runId: string; score: number };

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
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

export async function runBenchmark(opts: RunBenchmarkOptions): Promise<Snapshot> {
  const matrix = expandMatrix(opts.prompts, opts.config.runs.samples);
  const runs = await mapWithConcurrency<MatrixRow, RunResult>(
    matrix,
    opts.config.runs.parallel,
    async (row) => {
      opts.onProgress?.({ kind: 'run-start', rowId: row.id });
      const pluginDir =
        row.variant === 'baseline' ? opts.baselinePluginDir : opts.currentPluginDir;
      const r = await invokeClaude({
        command: opts.config.provider.command,
        extraArgs: opts.config.provider.extraArgs,
        prompt: row.prompt,
        pluginDir,
        timeoutMs: opts.config.provider.timeout * 1000,
        model: opts.config.provider.model,
        allowedTools: opts.config.provider.allowedTools,
      });
      opts.onProgress?.({
        kind: 'run-end',
        rowId: row.id,
        durationMs: r.durationMs,
        error: r.error,
      });
      return {
        id: row.id,
        promptId: row.promptId,
        variant: row.variant,
        sample: row.sample,
        output: r.output,
        durationMs: r.durationMs,
        exitCode: r.exitCode,
        error: r.error,
      };
    },
  );

  const judgeCfg = judgeConfigFromConfig(opts.config);
  const judgments = await mapWithConcurrency<RunResult, Judgment>(
    runs,
    opts.config.runs.parallel,
    async (run) => {
      opts.onProgress?.({ kind: 'judge-start', runId: run.id });
      const prompt = opts.prompts.find((p) => p.id === run.promptId);
      if (!prompt) throw new Error(`prompt not found: ${run.promptId}`);
      if (run.error || run.output.length === 0) {
        return {
          runId: run.id,
          score: 0,
          rationale: `run failed: ${run.error ?? 'empty output'}`,
          rubricHash: '',
          judgeProvider: judgeCfg.provider,
          judgeModel: judgeCfg.model,
          raw: '',
        };
      }
      const j = await judge(judgeCfg, {
        prompt: prompt.prompt,
        output: run.output,
        rubric: prompt.rubric,
      });
      opts.onProgress?.({ kind: 'judge-end', runId: run.id, score: j.score });
      return { runId: run.id, ...j };
    },
  );

  const scoreOf = (runId: string): number =>
    judgments.find((j) => j.runId === runId)?.score ?? 0;
  const baselineScores = runs
    .filter((r) => r.variant === 'baseline')
    .map((r) => scoreOf(r.id));
  const currentScores = runs.filter((r) => r.variant === 'current').map((r) => scoreOf(r.id));
  const baseline = stats(baselineScores);
  const current = stats(currentScores);

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
    summary: { baseline, current, delta: current.mean - baseline.mean },
  };
}
