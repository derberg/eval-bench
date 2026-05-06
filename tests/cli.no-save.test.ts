import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let server: Server;
let judgeUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          message: { content: '{"score":4,"rationale":"the model answered well and cited sources"}' },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) judgeUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ef-nosave-'));
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 't@t'], { cwd: root });
  await execa('git', ['config', 'user.name', 't'], { cwd: root });
  writeFileSync(join(root, 'f'), '1');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'v1', '-q'], { cwd: root });
  await execa('git', ['tag', 'v1'], { cwd: root });
  writeFileSync(join(root, 'f'), '2');
  await execa('git', ['commit', '-am', 'v2', '-q'], { cwd: root });
  const fakeClaude = resolve('tests/fixtures/fake-claude.js');
  chmodSync(fakeClaude, 0o755);
  writeFileSync(
    join(root, 'eval-bench.yaml'),
    `plugin:\n  path: ./\nprovider:\n  command: node\n  extraArgs: ['${fakeClaude}']\n  timeout: 10\njudge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\nruns:\n  samples: 1\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`,
  );
  writeFileSync(
    join(root, 'prompts.yaml'),
    `- id: p1\n  prompt: hello-1\n  rubric: r\n- id: p2\n  prompt: hello-2\n  rubric: r\n`,
  );
  return root;
}

const cliPath = resolve('src/cli/index.ts');
const sharedArgs = ['--config', 'eval-bench.yaml', '--prompts', 'prompts.yaml'];

describe('eb run --no-save', () => {
  it('runs the matrix without writing anything under the snapshots dir', async () => {
    const repo = await makeRepo();
    const { exitCode, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--baseline', 'v1', '--no-save', '--only', 'p1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/ephemeral/);
    expect(stdout).toMatch(/Run complete/);
    // The configured snapshots dir must stay untouched. The ephemeral run
    // writes to a tempdir under /tmp instead. (Pre-0.13 the tempdir was
    // rm-rf'd on exit; 0.13+ keeps it so the user can read outputs and
    // open view.html — see the next test.)
    if (existsSync(join(repo, 'snaps'))) {
      const entries = await readdir(join(repo, 'snaps'));
      expect(entries).toHaveLength(0);
    }
  }, 60_000);

  it('keeps the tempdir, writes view.html, and prints copy-pasteable view paths', async () => {
    const repo = await makeRepo();
    const { exitCode, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--baseline', 'v1', '--no-save', '--only', 'p1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    // The CLI must print the snapshot dir, the view.html path, and the
    // copy-pasteable `view --snapshot-dir` form. Without these the user
    // can't get to the actual model outputs — which was the whole point of
    // keeping the tempdir.
    const tempPathMatch = stdout.match(/Outputs:\s+(\S+)\//);
    expect(tempPathMatch, `expected stdout to print 'Outputs: <path>/' — got:\n${stdout}`).not.toBeNull();
    const snapshotDir = tempPathMatch![1];
    expect(stdout).toMatch(/View HTML:\s+\S+\/view\.html/);
    expect(stdout).toMatch(/eval-bench view \S+ --snapshot-dir \S+/);
    // The promised paths must actually exist after the run — pre-fix, they
    // were rm-rf'd before the user could read this hint.
    expect(existsSync(snapshotDir)).toBe(true);
    expect(existsSync(join(snapshotDir, 'snapshot.json'))).toBe(true);
    expect(existsSync(join(snapshotDir, 'view.html'))).toBe(true);
  }, 60_000);

  it('view --snapshot-dir <path> can render an ephemeral snapshot from outside the configured snapshots dir', async () => {
    const repo = await makeRepo();
    // First, run an ephemeral matrix and capture the printed snapshot dir.
    const run = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--baseline', 'v1', '--no-save', '--only', 'p1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(run.exitCode).toBe(0);
    const tempPathMatch = run.stdout.match(/Outputs:\s+(\S+?)\/[^/\s]+\/$/m)
      ?? run.stdout.match(/Outputs:\s+(\S+)\/[^/\s]+\//);
    expect(tempPathMatch, `expected stdout to print Outputs path — got:\n${run.stdout}`).not.toBeNull();
    // The "Outputs: <root>/<name>/" line — strip the trailing /<name>/ to
    // get the snapshots root.
    const snapshotsRoot = tempPathMatch![1];
    const nameMatch = run.stdout.match(/eval-bench view (\S+) --snapshot-dir (\S+)/);
    expect(nameMatch).not.toBeNull();
    const name = nameMatch![1];
    const printedDir = nameMatch![2];

    // Now invoke `view <name> --snapshot-dir <printedDir>` — should succeed
    // without needing the configured snapshots.dir to contain anything.
    const view = await execa(
      'npx',
      ['tsx', cliPath, 'view', name, '--snapshot-dir', printedDir],
      { cwd: repo, reject: false },
    );
    expect(view.exitCode).toBe(0);
    expect(view.stdout + view.stderr).toMatch(new RegExp(`opened view for snapshot "${name}"`));
    // Sanity: view.html should now exist (if it didn't already from the run).
    expect(existsSync(join(snapshotsRoot, name, 'view.html'))).toBe(true);
  }, 60_000);

  it('prints the judge rationale to stdout so the user can read it without opening view.html', async () => {
    const repo = await makeRepo();
    const { exitCode, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--baseline', 'v1', '--no-save', '--only', 'p1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    // The judge fixture above returns rationale "the model answered well and
    // cited sources" — that string must surface in stdout, indented under the
    // [N/N] progress line. The `score 4.0` prefix is how `judgeResult` formats.
    expect(stdout).toMatch(/score 4\.0/);
    expect(stdout).toMatch(/the model answered well and cited sources/);
  }, 60_000);

  it('rejects --no-save combined with --save-as / --retry-failed / --rejudge / --force / --compare', async () => {
    const repo = await makeRepo();
    const cases = [
      ['--save-as', 'x'],
      ['--retry-failed'],
      ['--rejudge'],
      ['--force'],
      ['--compare', 'whatever'],
    ];
    for (const extra of cases) {
      const { exitCode, stderr, stdout } = await execa(
        'npx',
        ['tsx', cliPath, 'run', '--baseline', 'v1', '--no-save', ...extra, ...sharedArgs],
        { cwd: repo, reject: false },
      );
      expect(exitCode, `expected nonzero for --no-save ${extra.join(' ')}`).not.toBe(0);
      expect(stderr + stdout).toMatch(/--no-save/);
    }
  }, 60_000);
});
