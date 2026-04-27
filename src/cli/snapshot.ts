import { listSnapshots, loadSnapshot, removeSnapshot } from '../snapshot.js';

export async function snapshotList(dir: string): Promise<string[]> {
  return listSnapshots(dir);
}

export async function snapshotShow(dir: string, name: string): Promise<string> {
  const s = await loadSnapshot(dir, name);
  const lines: string[] = [];
  lines.push(`name:        ${s.name}`);
  lines.push(`created:     ${s.createdAt}`);
  lines.push(`baselineRef: ${s.plugin.baselineRef}`);
  lines.push(`currentRef:  ${s.plugin.currentRef}`);
  lines.push(`prompts:     ${s.prompts.length}`);
  lines.push(`runs:        ${s.runs.length}`);
  lines.push(`baseline mean ${s.summary.baseline.mean.toFixed(2)} (n=${s.summary.baseline.n})`);
  lines.push(`current  mean ${s.summary.current.mean.toFixed(2)} (n=${s.summary.current.n})`);
  lines.push(`delta    ${s.summary.delta >= 0 ? '+' : ''}${s.summary.delta.toFixed(2)}`);
  return lines.join('\n');
}

export async function snapshotRm(dir: string, name: string): Promise<void> {
  await removeSnapshot(dir, name);
}
