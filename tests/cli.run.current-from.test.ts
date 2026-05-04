import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

let server: Server;
let judgeUrl = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
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

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ef-cf-'));
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
    `plugin:\n  path: ./\nprovider:\n  command: node\n  extraArgs: ['${fakeClaude}']\n  timeout: 10\njudge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\nruns:\n  samples: 2\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`,
  );
  writeFileSync(join(root, 'prompts.yaml'), `- id: p1\n  prompt: hello\n  rubric: score 0-5\n`);
  return root;
}

const cliPath = resolve('src/cli/index.ts');
const sharedArgs = ['--config', 'eval-bench.yaml', '--prompts', 'prompts.yaml'];

describe('eb run --current-from', () => {
  it('reuses current runs from a saved snapshot and only runs baseline side', async () => {
    const repo = await makeRepo();
    // Seed: eval at HEAD (v2) — captured as the cached "current" side.
    const seed = await execa(
      'npx',
      ['tsx', cliPath, 'eval', '--save-as', 'wip', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(seed.exitCode).toBe(0);

    const seedSnap = JSON.parse(
      await readFile(join(repo, 'snaps', 'wip', 'snapshot.json'), 'utf8'),
    );
    expect(seedSnap.runs.every((r: { variant: string }) => r.variant === 'current')).toBe(true);

    // Run with --current-from wip; baseline is freshly executed at v1.
    const { exitCode, stdout } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'run',
        '--baseline',
        'v1',
        '--current-from',
        'wip',
        '--save-as',
        'iter',
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cached from snapshot "wip"/);
    expect(stdout).toMatch(/2 runs reused/);

    const iterSnap = JSON.parse(
      await readFile(join(repo, 'snaps', 'iter', 'snapshot.json'), 'utf8'),
    );
    // 1 prompt × 2 samples × 2 variants = 4 runs total
    expect(iterSnap.runs).toHaveLength(4);
    const baselineRuns = iterSnap.runs.filter((r: { variant: string }) => r.variant === 'baseline');
    const currentRuns = iterSnap.runs.filter((r: { variant: string }) => r.variant === 'current');
    expect(baselineRuns).toHaveLength(2);
    expect(currentRuns).toHaveLength(2);
    // Reused current runs carry the original outputs verbatim.
    const seedOutputs = seedSnap.runs.map((r: { output: string }) => r.output).sort();
    const reusedOutputs = currentRuns.map((r: { output: string }) => r.output).sort();
    expect(reusedOutputs).toEqual(seedOutputs);
    // Current ref/sha are inherited from the cached snapshot.
    expect(iterSnap.plugin.currentRef).toBe(seedSnap.plugin.currentRef);
    expect(iterSnap.plugin.currentSha).toBe(seedSnap.plugin.currentSha);
  }, 60_000);

  it('combines --baseline-from and --current-from into a snapshot with no fresh runs', async () => {
    const repo = await makeRepo();
    // Seed two single-variant snapshots at different refs.
    const seedBase = await execa(
      'npx',
      ['tsx', cliPath, 'eval', '--save-as', 'base', '--ref', 'v1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(seedBase.exitCode).toBe(0);

    const seedCur = await execa(
      'npx',
      ['tsx', cliPath, 'eval', '--save-as', 'cur', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(seedCur.exitCode).toBe(0);

    // Stitch them into a dual-variant snapshot — no claude/judge work needed.
    const { exitCode, stdout } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'run',
        '--baseline-from',
        'base',
        '--current-from',
        'cur',
        '--save-as',
        'merged',
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/cached from snapshot "base"/);
    expect(stdout).toMatch(/cached from snapshot "cur"/);

    const mergedSnap = JSON.parse(
      await readFile(join(repo, 'snaps', 'merged', 'snapshot.json'), 'utf8'),
    );
    expect(mergedSnap.runs).toHaveLength(4);
    const baselineRuns = mergedSnap.runs.filter(
      (r: { variant: string }) => r.variant === 'baseline',
    );
    const currentRuns = mergedSnap.runs.filter(
      (r: { variant: string }) => r.variant === 'current',
    );
    expect(baselineRuns).toHaveLength(2);
    expect(currentRuns).toHaveLength(2);
    expect(mergedSnap.complete).toBe(true);
  }, 60_000);

  it('rejects --current and --current-from together', async () => {
    const repo = await makeRepo();
    const { exitCode, stderr, stdout } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'run',
        '--current',
        'HEAD',
        '--current-from',
        'wip',
        '--save-as',
        'x',
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(1);
    expect(stderr + stdout).toMatch(/mutually exclusive/);
  }, 30_000);
});
