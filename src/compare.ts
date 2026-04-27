import type { Snapshot, Comparison, PromptDelta, Judgment, RunResult } from './types.js';

const VERDICT_THRESHOLD = 0.2;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function scoresForPromptAndVariant(
  snap: Snapshot,
  promptId: string,
  variant: 'baseline' | 'current',
): number[] {
  const runIds = snap.runs
    .filter((r: RunResult) => r.promptId === promptId && r.variant === variant)
    .map((r) => r.id);
  return snap.judgments.filter((j: Judgment) => runIds.includes(j.runId)).map((j) => j.score);
}

export function compareSnapshots(from: Snapshot, to: Snapshot): Comparison {
  const promptIds = Array.from(
    new Set([...from.prompts.map((p) => p.id), ...to.prompts.map((p) => p.id)]),
  );
  const perPrompt: PromptDelta[] = promptIds.map((pid) => {
    const baselineMean = mean(scoresForPromptAndVariant(from, pid, 'current'));
    const currentMean = mean(scoresForPromptAndVariant(to, pid, 'current'));
    const delta = currentMean - baselineMean;
    const verdict: PromptDelta['verdict'] =
      delta >= VERDICT_THRESHOLD
        ? 'improved'
        : delta <= -VERDICT_THRESHOLD
          ? 'regressed'
          : 'stable';
    return { promptId: pid, baselineMean, currentMean, delta, verdict };
  });
  const netDelta = mean(perPrompt.map((d) => d.delta));
  return {
    from: from.name,
    to: to.name,
    netDelta,
    perPrompt,
    improvements: perPrompt.filter((d) => d.verdict === 'improved'),
    stable: perPrompt.filter((d) => d.verdict === 'stable'),
    regressions: perPrompt.filter((d) => d.verdict === 'regressed'),
  };
}

function fmt(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return n >= 0 ? `+${s}` : s;
}

function verdictGlyph(v: 'improved' | 'stable' | 'regressed'): string {
  return v === 'improved' ? '✓ improved' : v === 'regressed' ? '✗ regressed' : '~ stable';
}

export function formatComparisonMarkdown(cmp: Comparison): string {
  const lines: string[] = [];
  lines.push(`# Benchmark comparison: \`${cmp.from}\` → \`${cmp.to}\``);
  lines.push('');
  lines.push(`**Net delta:** ${fmt(cmp.netDelta)}`);
  lines.push('');
  lines.push('| Prompt | Baseline | Current | Δ | Verdict |');
  lines.push('|---|---|---|---|---|');
  for (const d of cmp.perPrompt) {
    lines.push(
      `| ${d.promptId} | ${d.baselineMean.toFixed(2)} | ${d.currentMean.toFixed(2)} | ${fmt(d.delta)} | ${verdictGlyph(d.verdict)} |`,
    );
  }
  return lines.join('\n');
}
