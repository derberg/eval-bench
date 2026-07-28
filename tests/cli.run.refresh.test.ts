import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

let server: Server;
let judgeUrl = '';
let judgeScore = 4;
let judgeCalls = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      judgeCalls += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ message: { content: `{"score":${judgeScore},"rationale":"ok"}` } }),
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

const promptsV1 = `- id: p1\n  prompt: hello-one\n  rubric: score 0-5\n- id: p2\n  prompt: hello-two\n  rubric: score 0-5\n`;
const promptsV2 = `- id: p1\n  prompt: hello-one-CHANGED\n  rubric: score 0-5\n- id: p2\n  prompt: hello-two\n  rubric: score 0-5\n`;

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ef-rf-'));
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
  writeFileSync(join(root, 'prompts.yaml'), promptsV1);
  return root;
}

const cliPath = resolve('src/cli/index.ts');
const sharedArgs = ['--config', 'eval-bench.yaml', '--prompts', 'prompts.yaml'];

describe('eb run --refresh', () => {
  it('re-runs only the --only prompts, preserving every other row and judgment', async () => {
    const repo = await makeRepo();
    judgeScore = 4;

    // Seed: 2 prompts × 2 samples × 2 variants = 8 rows.
    const seed = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--baseline', 'v1', '--save-as', 'iter', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(seed.exitCode).toBe(0);
    const seedSnap = JSON.parse(
      await readFile(join(repo, 'snaps', 'iter', 'snapshot.json'), 'utf8'),
    );
    expect(seedSnap.runs).toHaveLength(8);

    // Change p1's prompt text so refreshed rows are distinguishable, then
    // refresh p1 only. fake-claude echoes the prompt back.
    writeFileSync(join(repo, 'prompts.yaml'), promptsV2);
    judgeScore = 3;
    const callsBefore = judgeCalls;
    const { exitCode, stdout } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'run',
        '--baseline',
        'v1',
        '--save-as',
        'iter',
        '--refresh',
        '--only',
        'p1',
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Refreshing 2 current-variant runs \(1 prompt\) in snapshot "iter" — 6 rows preserved/);
    // Only the 2 re-run rows hit the judge.
    expect(judgeCalls - callsBefore).toBe(2);

    const snap = JSON.parse(await readFile(join(repo, 'snaps', 'iter', 'snapshot.json'), 'utf8'));
    expect(snap.runs).toHaveLength(8);
    expect(snap.judgments).toHaveLength(8);
    expect(snap.complete).toBe(true);

    const rows = new Map(snap.runs.map((r: { id: string; output: string }) => [r.id, r.output]));
    const seedRows = new Map(
      seedSnap.runs.map((r: { id: string; output: string }) => [r.id, r.output]),
    );
    // p1 current rows re-ran against the new prompt text.
    expect(rows.get('p1::current::1')).toContain('hello-one-CHANGED');
    expect(rows.get('p1::current::2')).toContain('hello-one-CHANGED');
    // p1 baseline and all p2 rows are byte-identical to the seed.
    for (const id of ['p1::baseline::1', 'p1::baseline::2', 'p2::baseline::1', 'p2::baseline::2', 'p2::current::1', 'p2::current::2']) {
      expect(rows.get(id)).toBe(seedRows.get(id));
    }
    // Refreshed rows carry new judgments; preserved rows keep their old score.
    const scores = new Map(
      snap.judgments.map((j: { runId: string; score: number }) => [j.runId, j.score]),
    );
    expect(scores.get('p1::current::1')).toBe(3);
    expect(scores.get('p1::current::2')).toBe(3);
    expect(scores.get('p2::current::1')).toBe(4);
  }, 60_000);

  it('errors when the snapshot does not exist', async () => {
    const repo = await makeRepo();
    const { exitCode, stderr, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--refresh', '--save-as', 'ghost', '--only', 'p1', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(1);
    expect(stderr + stdout).toMatch(/No snapshot named "ghost" — nothing to refresh/);
  }, 30_000);

  it('rejects --refresh with --force', async () => {
    const repo = await makeRepo();
    const { exitCode, stderr, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--refresh', '--force', '--save-as', 'x', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(1);
    expect(stderr + stdout).toMatch(/--refresh and --force are mutually exclusive/);
  }, 30_000);

  it('rejects --refresh with --rejudge', async () => {
    const repo = await makeRepo();
    const { exitCode, stderr, stdout } = await execa(
      'npx',
      ['tsx', cliPath, 'run', '--refresh', '--rejudge', '--save-as', 'x', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(1);
    expect(stderr + stdout).toMatch(/--refresh and --rejudge are mutually exclusive/);
  }, 30_000);
});
