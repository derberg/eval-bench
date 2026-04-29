import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { runBenchmark } from '../src/run.js';
import type { Config, PromptSpec, Snapshot } from '../src/types.js';

let server: Server;
let judgeUrl = '';
let judgeMode: 'ok' | 'fail' = 'ok';

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (judgeMode === 'fail') {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          message: { content: '{"score": 4, "rationale": "ok"}' },
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

const fakeClaude = resolve('tests/fixtures/fake-claude.js');
const fakeClaudeCwd = resolve('tests/fixtures/fake-claude-cwd.js');
chmodSync(fakeClaude, 0o755);
chmodSync(fakeClaudeCwd, 0o755);

const prompts: PromptSpec[] = [{ id: 'p1', prompt: 'x', rubric: 'r' }];

function baseConfig(): Config {
  return {
    plugin: { path: '/tmp/plugin', gitRoot: '/tmp/plugin' },
    provider: {
      command: 'node',
      extraArgs: [fakeClaude],
      timeout: 30,
      model: null,
      allowedTools: null,
      cwd: null,
    },
    judge: {
      provider: 'ollama',
      model: 'q',
      endpoint: judgeUrl,
      apiKeyEnv: null,
      temperature: 0,
      maxTokens: 256,
    },
    runs: { samples: 2, parallel: 2 },
    snapshots: { dir: '/tmp/snaps' },
  };
}

describe('runBenchmark', () => {
  it('runs the full matrix and judges each output', async () => {
    judgeMode = 'ok';
    const snap = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test',
    });
    expect(snap.runs).toHaveLength(4);
    expect(snap.judgments).toHaveLength(4);
    expect(snap.judgments.every((j) => j.score === 4)).toBe(true);
    expect(snap.summary.baseline.n).toBe(2);
    expect(snap.summary.current.n).toBe(2);
    expect(snap.complete).toBe(true);
  });

  it('records score 0 when judge throws and still completes the batch', async () => {
    judgeMode = 'fail';
    const snap = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-judge-fail',
    });
    judgeMode = 'ok';
    expect(snap.runs).toHaveLength(4);
    expect(snap.judgments).toHaveLength(4);
    expect(snap.judgments.every((j) => j.score === 0)).toBe(true);
    expect(snap.judgments.every((j) => j.rationale.startsWith('judge failed:'))).toBe(true);
    expect(snap.judgments.every((j) => typeof j.error === 'string')).toBe(true);
    expect(snap.complete).toBe(true);
  });

  it('on resume, re-judges only failed judgments without re-invoking Claude', async () => {
    judgeMode = 'fail';
    const failed = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-rejudge',
    });
    expect(failed.judgments.every((j) => j.error !== null)).toBe(true);

    judgeMode = 'ok';
    let runStarts = 0;
    let judgeStarts = 0;
    const recovered = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-rejudge',
      resume: failed,
      onProgress: (ev) => {
        if (ev.kind === 'run-start') runStarts++;
        if (ev.kind === 'judge-start') judgeStarts++;
      },
    });
    expect(runStarts).toBe(0);
    expect(judgeStarts).toBe(4);
    expect(recovered.judgments).toHaveLength(4);
    expect(recovered.judgments.every((j) => j.error === null)).toBe(true);
    expect(recovered.judgments.every((j) => j.score === 4)).toBe(true);
  });

  it('checkpoints partial state after each row', async () => {
    judgeMode = 'ok';
    const partials: Snapshot[] = [];
    const snap = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-ckpt',
      onCheckpoint: async (p) => {
        partials.push(p);
      },
    });
    expect(partials).toHaveLength(4);
    expect(partials.every((p) => p.complete === false)).toBe(true);
    expect(partials.at(-1)!.runs).toHaveLength(4);
    expect(snap.complete).toBe(true);
  });

  it('spawns each row under the snapshot dir using the default cwd template, separating baseline and current by variant', async () => {
    judgeMode = 'ok';
    const snapsRoot = mkdtempSync(join(tmpdir(), 'ef-snaps-'));
    const cfg = baseConfig();
    cfg.provider.extraArgs = [fakeClaudeCwd];
    // Default template, the same one zod applies when cwd is omitted.
    cfg.provider.cwd =
      '{{snapshots_dir}}/{{snapshot_name}}/{{variant}}/{{prompt_id}}/{{sample}}';
    cfg.snapshots.dir = snapsRoot;
    cfg.runs.samples = 1;
    const snap = await runBenchmark({
      config: cfg,
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'wip',
    });
    expect(snap.runs).toHaveLength(2);
    // Recorded cwd is canonical (realpath-resolved); compare against the
    // realpath of the snapshots root so macOS symlinks don't trip the test.
    const canonicalSnapsRoot = realpathSync(snapsRoot);
    for (const r of snap.runs) {
      expect(r.cwd).not.toBeNull();
      // Every cwd lives under the per-snapshot subdir, namespaced by
      // variant/prompt/sample.
      expect(r.cwd!.startsWith(`${canonicalSnapsRoot}/wip/`)).toBe(true);
      expect(r.cwd).toContain(`/${r.variant}/${r.promptId}/${r.sample}`);
      // Provider actually ran there; the fake-claude-cwd fixture writes a
      // marker file at process.cwd() and echoes it.
      expect(existsSync(join(r.cwd!, 'artifact.txt'))).toBe(true);
      expect(r.output).toContain(`[CWD=${r.cwd}]`);
    }
    // Baseline and current land in distinct dirs thanks to {{variant}}.
    const cwds = new Set(snap.runs.map((r) => r.cwd));
    expect(cwds.size).toBe(snap.runs.length);
  });

  it('opts out of the per-sample cwd when provider.cwd is null (legacy behavior)', async () => {
    judgeMode = 'ok';
    const snap = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-no-cwd',
    });
    expect(snap.runs.every((r) => r.cwd === null)).toBe(true);
  });

  it('skips already-completed rows when resuming', async () => {
    judgeMode = 'ok';
    const first = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-resume',
    });
    let invocations = 0;
    const second = await runBenchmark({
      config: baseConfig(),
      prompts,
      baselinePluginDir: '/tmp/a',
      currentPluginDir: '/tmp/b',
      baselineRef: 'v1',
      baselineSha: 'abc',
      currentRef: 'HEAD',
      currentSha: 'def',
      name: 'test-resume',
      resume: first,
      onProgress: (ev) => {
        if (ev.kind === 'run-start') invocations++;
      },
    });
    expect(invocations).toBe(0);
    expect(second.runs).toHaveLength(4);
    expect(second.judgments).toHaveLength(4);
    expect(second.complete).toBe(true);
  });
});
