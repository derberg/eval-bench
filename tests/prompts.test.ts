import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPrompts } from '../src/prompts.js';

function writeTempYaml(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'ef-test-'));
  const path = join(dir, 'prompts.yaml');
  writeFileSync(path, content);
  return path;
}

describe('loadPrompts', () => {
  it('parses a valid prompts file', () => {
    const path = writeTempYaml(`
- id: p1
  prompt: "Hello"
  rubric: "Score 0-5"
- id: p2
  prompt: "World"
  rubric: "Score 0-5"
`);
    const prompts = loadPrompts(path);
    expect(prompts).toHaveLength(2);
    expect(prompts[0].id).toBe('p1');
  });

  it('rejects duplicate ids', () => {
    const path = writeTempYaml(`
- id: p1
  prompt: "a"
  rubric: "r"
- id: p1
  prompt: "b"
  rubric: "r"
`);
    expect(() => loadPrompts(path)).toThrow(/duplicate prompt id: p1/);
  });

  it('rejects empty prompt', () => {
    const path = writeTempYaml(`
- id: p1
  prompt: ""
  rubric: "r"
`);
    expect(() => loadPrompts(path)).toThrow();
  });

  it('rejects non-kebab-case id', () => {
    const path = writeTempYaml(`
- id: NOT_KEBAB
  prompt: x
  rubric: r
`);
    expect(() => loadPrompts(path)).toThrow();
  });
});
