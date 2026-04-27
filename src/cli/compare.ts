import { loadSnapshot } from '../snapshot.js';
import { compareSnapshots, formatComparisonMarkdown } from '../compare.js';

export interface CompareOptions {
  dir: string;
  from: string;
  to: string;
  format: 'md' | 'json' | 'both';
  threshold?: number;
}

export async function compareCommand(opts: CompareOptions): Promise<string> {
  const a = await loadSnapshot(opts.dir, opts.from);
  const b = await loadSnapshot(opts.dir, opts.to);
  const cmp = compareSnapshots(a, b);
  if (opts.threshold !== undefined) {
    cmp.perPrompt = cmp.perPrompt.filter((d) => Math.abs(d.delta) > opts.threshold!);
  }
  if (opts.format === 'json') return JSON.stringify(cmp, null, 2);
  if (opts.format === 'md') return formatComparisonMarkdown(cmp);
  return formatComparisonMarkdown(cmp) + '\n\n' + JSON.stringify(cmp, null, 2);
}
