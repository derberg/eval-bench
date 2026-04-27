import { execa } from 'execa';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Worktree {
  path: string;
  sha: string;
  cleanup: () => Promise<void>;
}

export async function resolveSha(gitRoot: string, ref: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--verify', ref], { cwd: gitRoot });
  return stdout.trim();
}

export async function createWorktree(gitRoot: string, ref: string): Promise<Worktree> {
  const sha = await resolveSha(gitRoot, ref);
  const wtPath = mkdtempSync(join(tmpdir(), 'ef-wt-'));
  await execa('git', ['worktree', 'add', '--detach', wtPath, sha], { cwd: gitRoot });
  return {
    path: wtPath,
    sha,
    cleanup: async () => {
      await execa('git', ['worktree', 'remove', '--force', wtPath], { cwd: gitRoot }).catch(
        () => {
          /* best effort */
        },
      );
    },
  };
}
