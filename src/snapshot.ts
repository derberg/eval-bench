import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Snapshot } from './types.js';

const NAME_RE = /^[a-z0-9][a-z0-9._-]*$/i;

function validateName(name: string): void {
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid snapshot name: ${name} (must match ${NAME_RE})`);
  }
}

export async function saveSnapshot(snap: Snapshot, dir: string): Promise<string> {
  validateName(snap.name);
  const target = join(dir, snap.name);
  await mkdir(target, { recursive: true });
  const path = join(target, 'snapshot.json');
  await writeFile(path, JSON.stringify(snap, null, 2));
  return path;
}

export async function loadSnapshot(dir: string, name: string): Promise<Snapshot> {
  validateName(name);
  const path = join(dir, name, 'snapshot.json');
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as Snapshot;
}

export async function listSnapshots(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && NAME_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

export async function removeSnapshot(dir: string, name: string): Promise<void> {
  validateName(name);
  const target = resolve(dir, name);
  if (!target.startsWith(resolve(dir))) {
    throw new Error('refusing to remove outside snapshots dir');
  }
  await rm(target, { recursive: true, force: true });
}
