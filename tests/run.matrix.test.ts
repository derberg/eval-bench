import { describe, it, expect } from 'vitest';
import { resolve as resolvePath } from 'node:path';
import { expandMatrix, resolveCwd } from '../src/run.js';
import type { PromptSpec } from '../src/types.js';

const prompts: PromptSpec[] = [
  { id: 'p1', prompt: 'x', rubric: 'r' },
  { id: 'p2', prompt: 'y', rubric: 'r' },
];

describe('expandMatrix', () => {
  it('produces prompts × variants × samples rows', () => {
    const m = expandMatrix(prompts, 2);
    expect(m).toHaveLength(2 * 2 * 2);
    expect(m.filter((r) => r.variant === 'baseline')).toHaveLength(4);
    expect(m.filter((r) => r.variant === 'current')).toHaveLength(4);
  });

  it('assigns stable ids of form <promptId>::<variant>::<sample>', () => {
    const m = expandMatrix(prompts, 1);
    const ids = m.map((r) => r.id).sort();
    expect(ids).toEqual([
      'p1::baseline::1',
      'p1::current::1',
      'p2::baseline::1',
      'p2::current::1',
    ]);
  });
});

describe('resolveCwd', () => {
  const ctx = {
    snapshotsDir: './.eval-bench/snapshots',
    snapshotName: 'wip',
    variant: 'current' as const,
    promptId: 'find-user',
    sample: 2,
    pluginDir: '/repo/plugin',
  };

  it('returns null when template is null (legacy opt-out)', () => {
    expect(resolveCwd(null, ctx)).toBeNull();
  });

  it('substitutes the default template into a per-sample absolute path', () => {
    const out = resolveCwd(
      '{{snapshots_dir}}/{{snapshot_name}}/{{variant}}/{{prompt_id}}/{{sample}}',
      ctx,
    );
    expect(out).toBe(resolvePath('./.eval-bench/snapshots/wip/current/find-user/2'));
  });

  it('substitutes plugin_dir verbatim', () => {
    const out = resolveCwd('{{plugin_dir}}/eval-tmp', ctx);
    expect(out).toBe(resolvePath('/repo/plugin/eval-tmp'));
  });

  it('leaves unknown {{vars}} untouched so typos surface as path components', () => {
    const out = resolveCwd('/tmp/{{prompt_id}}/{{bogus}}', ctx);
    expect(out).toBe(resolvePath('/tmp/find-user/{{bogus}}'));
  });

  it('tolerates whitespace inside the {{ var }} braces', () => {
    const out = resolveCwd('/tmp/{{ prompt_id }}/{{ sample }}', ctx);
    expect(out).toBe(resolvePath('/tmp/find-user/2'));
  });
});
