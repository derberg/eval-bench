import { describe, it, expect } from 'vitest';
import { buildJudgePrompt, hashRubric } from '../../src/judges/rubric.js';

describe('buildJudgePrompt', () => {
  it('includes the original prompt, output, and rubric', () => {
    const p = buildJudgePrompt({
      prompt: 'List products',
      output: 'A, B, C',
      rubric: 'Score 0-5',
    });
    expect(p).toContain('List products');
    expect(p).toContain('A, B, C');
    expect(p).toContain('Score 0-5');
    expect(p).toMatch(/Return ONLY.*JSON/i);
  });
});

describe('hashRubric', () => {
  it('returns a stable sha256 hex string', () => {
    expect(hashRubric('foo')).toBe(hashRubric('foo'));
    expect(hashRubric('foo')).not.toBe(hashRubric('bar'));
    expect(hashRubric('foo')).toMatch(/^[a-f0-9]{64}$/);
  });
});
