import { describe, it, expect } from 'vitest';
import { expandMatrix } from '../src/run.js';
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
