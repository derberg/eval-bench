import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execa } from 'execa';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';

// CENNSO-4550: a plugin in a subfolder of its git repository (plugins/docs).
// Both sides must load the plugin from that subfolder: the current side from
// the checkout, the baseline side from the same subfolder of the worktree.

let server: Server;
let judgeUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '{"score":4,"rationale":"ok"}' } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) judgeUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const fakeClaude = resolve('tests/fixtures/fake-claude-plugin-dir.js');
const cliPath = resolve('src/cli/index.ts');
const SUBDIR = join('plugins', 'docs');

async function makeRepoWithPluginSubfolder(): Promise<{ root: string; plugin: string }> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ef-subdir-')));
  const plugin = join(root, SUBDIR);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 't@t'], { cwd: root });
  await execa('git', ['config', 'user.name', 't'], { cwd: root });
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"docs","version":"1.0.0"}');
  writeFileSync(join(plugin, 'f'), '1');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'v1', '-q'], { cwd: root });
  await execa('git', ['tag', 'v1'], { cwd: root });
  writeFileSync(join(plugin, 'f'), '2');
  await execa('git', ['commit', '-am', 'v2', '-q'], { cwd: root });
  return { root, plugin };
}

function config(pluginBlock: string): string {
  return (
    `${pluginBlock}provider:\n  command: node\n  extraArgs: ['${fakeClaude}']\n  timeout: 10\n` +
    `judge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\n` +
    `runs:\n  samples: 1\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`
  );
}

function pluginDirOf(output: string): string {
  const m = output.match(/\[PLUGIN_DIR_FLAG=([^\]]*)\]/);
  if (!m) throw new Error(`no plugin dir in output: ${output}`);
  return m[1];
}

async function runAndReadDirs(
  cwd: string,
  command: 'run' | 'eval',
  extra: string[],
): Promise<Record<string, string>> {
  const { exitCode, stdout, stderr } = await execa(
    'npx',
    [
      'tsx',
      cliPath,
      command,
      '--save-as',
      's1',
      '--config',
      'eval-bench.yaml',
      '--prompts',
      'prompts.yaml',
      ...extra,
    ],
    { cwd, reject: false },
  );
  expect(exitCode, stdout + stderr).toBe(0);
  const snap = JSON.parse(await readFile(join(cwd, 'snaps', 's1', 'snapshot.json'), 'utf8'));
  const dirs: Record<string, string> = {};
  for (const r of snap.runs as { variant: string; output: string }[]) {
    dirs[r.variant] = pluginDirOf(r.output);
  }
  return dirs;
}

describe('plugin in a repository subfolder', () => {
  it('run from the plugin folder: baseline loads the subfolder of the worktree', async () => {
    const { plugin } = await makeRepoWithPluginSubfolder();
    writeFileSync(join(plugin, 'eval-bench.yaml'), config('plugin:\n  path: ./\n'));
    writeFileSync(join(plugin, 'prompts.yaml'), `- id: p1\n  prompt: hello\n  rubric: score 0-5\n`);

    const dirs = await runAndReadDirs(plugin, 'run', ['--baseline', 'v1']);

    expect(realpathSync(dirs.current)).toBe(plugin);
    // The worktree is removed after the run, so compare the path text.
    expect(dirs.baseline.endsWith(sep + SUBDIR)).toBe(true);
    expect(dirs.baseline.startsWith(join(plugin, ''))).toBe(false);
  }, 60_000);

  it('run with gitRoot at the repository root: both sides load plugin.path', async () => {
    const { root, plugin } = await makeRepoWithPluginSubfolder();
    writeFileSync(
      join(root, 'eval-bench.yaml'),
      config(`plugin:\n  path: ./${SUBDIR}\n  gitRoot: ./\n`),
    );
    writeFileSync(join(root, 'prompts.yaml'), `- id: p1\n  prompt: hello\n  rubric: score 0-5\n`);

    const dirs = await runAndReadDirs(root, 'run', ['--baseline', 'v1']);

    expect(realpathSync(dirs.current)).toBe(plugin);
    expect(dirs.baseline.endsWith(sep + SUBDIR)).toBe(true);
  }, 60_000);

  it('eval with gitRoot at the repository root: current loads plugin.path', async () => {
    const { root, plugin } = await makeRepoWithPluginSubfolder();
    writeFileSync(
      join(root, 'eval-bench.yaml'),
      config(`plugin:\n  path: ./${SUBDIR}\n  gitRoot: ./\n`),
    );
    writeFileSync(join(root, 'prompts.yaml'), `- id: p1\n  prompt: hello\n  rubric: score 0-5\n`);

    const dirs = await runAndReadDirs(root, 'eval', []);

    expect(realpathSync(dirs.current)).toBe(plugin);
  }, 60_000);
});
