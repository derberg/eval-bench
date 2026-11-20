import { describe, it, expect } from 'vitest';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateConfig } from '../src/cli/adopt.js';
import { parse } from 'yaml';
import type { Snapshot } from '../src/types.js';
import { applyOverrides as applyRunOverrides } from '../src/cli/run.js';
import { applyOverrides as applyEvalOverrides } from '../src/cli/eval.js';
import type { Config } from '../src/types.js';

function cfg(extraPlugins: string[]): Config {
  return {
    plugin: { path: './', gitRoot: './' },
    provider: {
      command: 'claude',
      extraArgs: [],
      timeout: 800,
      model: null,
      allowedTools: null,
      cwd: null,
      isolation: true,
      claudeAiConnectors: false,
      extraPlugins,
    },
    judge: {
      provider: 'claude-cli',
      model: 'sonnet',
      endpoint: null,
      apiKeyEnv: null,
      temperature: 0,
      maxTokens: 1024,
      template: null,
      isolation: true,
      extraArgs: [],
    },
    runs: { samples: 1, parallel: 1 },
    snapshots: { dir: './snaps' },
  };
}

describe('--with-plugin', () => {
  it('eb run appends each --with-plugin path to provider.extraPlugins, resolved to a full path', () => {
    // Stored resolved, so a snapshot, the isolation warning, and eb adopt
    // name the same folder whatever directory eb runs from later.
    const out = applyRunOverrides(cfg(['from-config']), { cwd: '.', withPlugin: ['a', '/abs/b'] });
    expect(out.provider.extraPlugins).toEqual([resolve('from-config'), resolve('a'), '/abs/b']);
  });

  it('eb eval appends each --with-plugin path to provider.extraPlugins', () => {
    const out = applyEvalOverrides(cfg([]), { cwd: '.', saveAs: 's', withPlugin: ['a'] });
    expect(out.provider.extraPlugins).toEqual([resolve('a')]);
  });
});

describe('eb run --with-plugin (CLI parsing)', () => {
  it('accepts the flag more than once and prints every extra plugin in the header', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ef-withplugin-'));
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'a'], { cwd: root });
    await execa('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'b'], { cwd: root });
    writeFileSync(
      join(root, 'eval-bench.yaml'),
      'plugin:\n  path: ./\njudge:\n  provider: claude-cli\n  model: sonnet\nsnapshots:\n  dir: ./snaps\n',
    );
    writeFileSync(join(root, 'prompts.yaml'), '- id: p1\n  prompt: hi\n  rubric: r\n');
    const { stdout, exitCode } = await execa(
      'npx',
      ['tsx', resolve('src/cli/index.ts'), 'run', '--config', 'eval-bench.yaml', '--prompts', 'prompts.yaml',
        '--dry-run', '--no-save', '--with-plugin', '/p/one', '--with-plugin', '/p/two'],
      { cwd: root, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('/p/one');
    expect(stdout).toContain('/p/two');
    expect(stdout).toMatch(/Extra plugin folder not found: \/p\/one/);
  }, 60_000);
  it('eb eval prints the extra plugins in its header too', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ef-withplugin-eval-'));
    await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
    await execa('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'a'], { cwd: root });
    writeFileSync(
      join(root, 'eval-bench.yaml'),
      'plugin:\n  path: ./\njudge:\n  provider: claude-cli\n  model: sonnet\nsnapshots:\n  dir: ./snaps\n',
    );
    writeFileSync(join(root, 'prompts.yaml'), '- id: p1\n  prompt: hi\n  rubric: r\n');
    const { stdout, exitCode } = await execa(
      'npx',
      ['tsx', resolve('src/cli/index.ts'), 'eval', '--save-as', 's', '--config', 'eval-bench.yaml',
        '--prompts', 'prompts.yaml', '--dry-run', '--with-plugin', '/p/one'],
      { cwd: root, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Plugins:.*\/p\/one/);
  }, 60_000);
});

describe('eb adopt', () => {
  it('keeps the isolation settings and extra args of the snapshot', () => {
    const snap = {
      config: {
        ...cfg(['/x']),
        provider: { ...cfg(['/x']).provider, isolation: false, claudeAiConnectors: true, extraArgs: ['--foo'] },
        judge: { ...cfg([]).judge, isolation: false, extraArgs: ['--bar'] },
      },
      judge: { provider: 'claude-cli', model: 'sonnet' },
    } as unknown as Snapshot;
    const out = parse(generateConfig(snap));
    expect(out.provider).toMatchObject({ isolation: false, claudeAiConnectors: true, extraPlugins: ['/x'], extraArgs: ['--foo'] });
    expect(out.judge).toMatchObject({ isolation: false, extraArgs: ['--bar'] });
  });
});
