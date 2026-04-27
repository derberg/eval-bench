import { describe, it, expectTypeOf } from 'vitest';
import type { Config, PromptSpec, RunResult, Judgment, Snapshot, Comparison } from '../src/types.js';

describe('types', () => {
  it('Config shape', () => {
    expectTypeOf<Config['plugin']['path']>().toBeString();
    expectTypeOf<Config['judge']['provider']>().toEqualTypeOf<
      | 'ollama'
      | 'anthropic'
      | 'openai'
      | 'openai-compatible'
      | 'openrouter'
      | 'github-models'
      | 'claude-cli'
    >();
    expectTypeOf<Config['runs']['samples']>().toBeNumber();
  });
  it('RunResult discriminated by variant', () => {
    expectTypeOf<RunResult['variant']>().toEqualTypeOf<'baseline' | 'current'>();
  });
  it('Snapshot contains runs and judgments', () => {
    expectTypeOf<Snapshot['runs']>().toEqualTypeOf<RunResult[]>();
    expectTypeOf<Snapshot['judgments']>().toEqualTypeOf<Judgment[]>();
  });
  it('Comparison shape', () => {
    expectTypeOf<Comparison['perPrompt']>().toBeArray();
  });
  it('PromptSpec has id, prompt, rubric', () => {
    expectTypeOf<PromptSpec>().toMatchTypeOf<{ id: string; prompt: string; rubric: string }>();
  });
});
