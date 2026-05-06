import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEMPLATE,
  buildJudgePrompt,
  hashRubric,
  validateJudgeTemplate,
} from '../../src/judges/rubric.js';

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

  it('uses a caller-supplied template when one is passed', () => {
    const tmpl =
      'Custom prelude.\n\nPROMPT={{prompt}} | OUTPUT={{output}} | RUBRIC={{rubric}}\nReturn {"score": N, "rationale": "..."}';
    const out = buildJudgePrompt({
      prompt: 'P',
      output: 'O',
      rubric: 'R',
      template: tmpl,
    });
    expect(out).toBe(
      'Custom prelude.\n\nPROMPT=P | OUTPUT=O | RUBRIC=R\nReturn {"score": N, "rationale": "..."}',
    );
    // The default's wording must really be gone — we swapped the wrapper,
    // we didn't append to it.
    expect(out).not.toContain('impartial evaluator');
  });

  it('falls back to DEFAULT_TEMPLATE when template is null', () => {
    const def = buildJudgePrompt({ prompt: 'p', output: 'o', rubric: 'r' });
    const explicit = buildJudgePrompt({
      prompt: 'p',
      output: 'o',
      rubric: 'r',
      template: null,
    });
    expect(explicit).toBe(def);
  });
});

describe('validateJudgeTemplate', () => {
  it('accepts the default template', () => {
    expect(() => validateJudgeTemplate(DEFAULT_TEMPLATE)).not.toThrow();
  });

  it('rejects a template missing any required placeholder, listing the missing names', () => {
    expect(() =>
      validateJudgeTemplate('only has {{prompt}} and {{rubric}}, no output'),
    ).toThrow(/\{\{output\}\}/);
    expect(() => validateJudgeTemplate('totally empty')).toThrow(
      /\{\{prompt\}\}.*\{\{output\}\}.*\{\{rubric\}\}/,
    );
  });
});

describe('DEFAULT_TEMPLATE', () => {
  it('contains the placeholders and JSON contract that the parser expects', () => {
    // If this fails, the docs that embed the default template (docs/judges.md
    // and docs/concepts.md) need updating too — their pins will catch it.
    expect(DEFAULT_TEMPLATE).toContain('{{prompt}}');
    expect(DEFAULT_TEMPLATE).toContain('{{output}}');
    expect(DEFAULT_TEMPLATE).toContain('{{rubric}}');
    expect(DEFAULT_TEMPLATE).toContain('"score"');
    expect(DEFAULT_TEMPLATE).toContain('"rationale"');
  });
});

describe('hashRubric', () => {
  it('returns a stable sha256 hex string', () => {
    expect(hashRubric('foo')).toBe(hashRubric('foo'));
    expect(hashRubric('foo')).not.toBe(hashRubric('bar'));
    expect(hashRubric('foo')).toMatch(/^[a-f0-9]{64}$/);
  });
});
