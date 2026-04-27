import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorktree, resolveSha } from '../src/swap.js';

async function makeRepo(): Promise<{ root: string; sha1: string; sha2: string }> {
  const root = mkdtempSync(join(tmpdir(), 'ef-git-'));
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 't@t'], { cwd: root });
  await execa('git', ['config', 'user.name', 't'], { cwd: root });
  writeFileSync(join(root, 'a.txt'), 'v1');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'v1', '-q'], { cwd: root });
  const { stdout: sha1 } = await execa('git', ['rev-parse', 'HEAD'], { cwd: root });
  writeFileSync(join(root, 'a.txt'), 'v2');
  await execa('git', ['commit', '-am', 'v2', '-q'], { cwd: root });
  const { stdout: sha2 } = await execa('git', ['rev-parse', 'HEAD'], { cwd: root });
  return { root, sha1: sha1.trim(), sha2: sha2.trim() };
}

describe('swap', () => {
  it('resolves a ref to a SHA', async () => {
    const { root, sha2 } = await makeRepo();
    expect(await resolveSha(root, 'HEAD')).toBe(sha2);
  });

  it('creates a worktree at a given ref and cleans up', async () => {
    const { root, sha1 } = await makeRepo();
    const wt = await createWorktree(root, sha1);
    expect(existsSync(join(wt.path, 'a.txt'))).toBe(true);
    expect(readFileSync(join(wt.path, 'a.txt'), 'utf8')).toBe('v1');
    await wt.cleanup();
    expect(existsSync(wt.path)).toBe(false);
  });

  it('rejects a non-existent ref', async () => {
    const { root } = await makeRepo();
    await expect(createWorktree(root, 'does-not-exist')).rejects.toThrow();
  });
});
