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

// Path of `pluginPath` relative to the top of its git repository, such as
// `plugins/docs`, or '' when the plugin sits at the top. A worktree checks out
// the whole repository, so the baseline plugin is this path inside it.
export async function pluginPathInRepo(pluginPath: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--show-prefix'], { cwd: pluginPath });
  return stdout.trim().replace(/\/$/, '');
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
