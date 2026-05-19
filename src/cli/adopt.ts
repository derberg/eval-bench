import { mkdir, cp, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { stringify } from 'yaml';
import { loadSnapshot } from '../snapshot.js';
import { ok, info, err, warn } from '../logger.js';
import type { Snapshot } from '../types.js';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function generateConfig(snap: Snapshot): string {
  const cfg = snap.config;
  const obj: Record<string, unknown> = {
    plugin: { path: './' },
    provider: {
      command: cfg.provider.command,
      timeout: cfg.provider.timeout,
      ...(cfg.provider.model ? { model: cfg.provider.model } : {}),
    },
    judge: {
      provider: snap.judge.provider,
      model: snap.judge.model,
      ...(cfg.judge.endpoint ? { endpoint: cfg.judge.endpoint } : {}),
    },
    runs: {
      samples: cfg.runs.samples,
    },
    snapshots: {
      dir: './.eval-bench/snapshots',
    },
  };
  return `# eval-bench configuration\n# See https://github.com/derberg/eval-bench/blob/main/docs/config.md\n\n${stringify(obj)}`;
}

function generatePrompts(snap: Snapshot): string {
  return stringify(
    snap.prompts.map((p) => ({ id: p.id, prompt: p.prompt, rubric: p.rubric })),
  );
}

export interface AdoptOptions {
  name: string;
  snapshotDir: string;
  cwd: string;
}

export async function adoptCommand(opts: AdoptOptions): Promise<number> {
  const srcDir = resolve(opts.snapshotDir, opts.name);

  if (!(await exists(join(srcDir, 'snapshot.json')))) {
    err(`No snapshot found at ${srcDir}`);
    return 1;
  }

  let snap: Snapshot;
  try {
    snap = await loadSnapshot(opts.snapshotDir, opts.name);
  } catch (e) {
    err(`Failed to load snapshot: ${(e as Error).message}`);
    return 1;
  }

  const evalBenchDir = join(opts.cwd, '.eval-bench');
  const snapshotsDir = join(evalBenchDir, 'snapshots');
  const destDir = join(snapshotsDir, opts.name);
  const configPath = join(evalBenchDir, 'eval-bench.yaml');
  const promptsPath = join(evalBenchDir, 'prompts.yaml');

  // Copy snapshot files (snapshot.json, view.html, per-sample dirs)
  await mkdir(destDir, { recursive: true });
  await cp(srcDir, destDir, { recursive: true });
  ok(`Snapshot copied → ${destDir}`);

  // Generate eval-bench.yaml if not present
  if (await exists(configPath)) {
    warn(`eval-bench.yaml already exists — skipped`);
  } else {
    await writeFile(configPath, generateConfig(snap), 'utf8');
    ok(`Created ${configPath}`);
  }

  // Generate prompts.yaml if not present
  if (await exists(promptsPath)) {
    warn(`prompts.yaml already exists — skipped`);
  } else {
    await writeFile(promptsPath, generatePrompts(snap), 'utf8');
    ok(`Created ${promptsPath}`);
  }

  info('');
  info(`  This snapshot is now persisted and can be used as a baseline:`);
  info(`  eval-bench run --baseline-from ${opts.name}`);
  info('');

  return 0;
}
