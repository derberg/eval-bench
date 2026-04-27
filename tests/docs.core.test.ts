import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('core docs', () => {
  it('quickstart covers install, init, run, compare', () => {
    const q = readFileSync('docs/quickstart.md', 'utf8');
    expect(q).toMatch(/eb init/);
    expect(q).toMatch(/eb run/);
    expect(q).toMatch(/--compare/);
  });
  it('concepts defines the core terms', () => {
    const c = readFileSync('docs/concepts.md', 'utf8');
    for (const term of [
      'plugin',
      'baseline',
      'current',
      'variant',
      'sample',
      'judge',
      'rubric',
      'snapshot',
      'subagent',
      'hook',
    ]) {
      expect(c.toLowerCase()).toContain(term);
    }
  });
  it('config.md documents every top-level field', () => {
    const c = readFileSync('docs/config.md', 'utf8');
    for (const k of ['plugin', 'provider', 'judge', 'runs', 'snapshots']) {
      expect(c).toContain(`### ${k}`);
    }
  });
  it('rubrics.md has examples of good and bad rubrics', () => {
    const r = readFileSync('docs/rubrics.md', 'utf8');
    expect(r.toLowerCase()).toMatch(/good example/);
    expect(r.toLowerCase()).toMatch(/bad example/);
  });
  it('judges.md documents every provider', () => {
    const j = readFileSync('docs/judges.md', 'utf8');
    for (const p of [
      'Ollama',
      'Anthropic',
      'OpenAI',
      'OpenAI-compatible',
      'OpenRouter',
      'GitHub Models',
      'Claude CLI',
    ]) {
      expect(j).toContain(p);
    }
  });
  it('ci.md has a complete GitHub Actions example', () => {
    const c = readFileSync('docs/ci.md', 'utf8');
    expect(c).toMatch(/runs-on: ubuntu-latest/);
    expect(c).toMatch(/ollama pull/);
    expect(c).toMatch(/fail-on-regression/);
  });
  it('troubleshooting.md covers common errors', () => {
    const t = readFileSync('docs/troubleshooting.md', 'utf8');
    for (const s of ['not a git repo', 'claude CLI not found', 'Ollama', 'judge response']) {
      expect(t).toContain(s);
    }
  });
  it('comparison-to-promptfoo.md answers usage decision', () => {
    const p = readFileSync('docs/comparison-to-promptfoo.md', 'utf8');
    expect(p.toLowerCase()).toMatch(/use eval-bench when/);
    expect(p.toLowerCase()).toMatch(/use raw promptfoo when/);
  });
});
