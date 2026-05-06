import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/cli/init.js';
import { DEFAULT_TEMPLATE } from '../src/judges/rubric.js';

describe('ef init', () => {
  it('writes eval-bench.yaml, prompts.yaml, snapshots/.gitkeep', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    await runInit({ cwd: dir, ci: false });
    expect(existsSync(join(dir, '.eval-bench', 'eval-bench.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.eval-bench', 'prompts.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.eval-bench', 'snapshots', '.gitkeep'))).toBe(true);
    expect(readFileSync(join(dir, '.eval-bench', 'eval-bench.yaml'), 'utf8')).toContain('judge:');
  });

  it('emits GH Actions workflow with --ci', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    await runInit({ cwd: dir, ci: true });
    expect(existsSync(join(dir, '.github', 'workflows', 'eval-bench.yml'))).toBe(true);
  });

  it('does not overwrite existing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    mkdirSync(join(dir, '.eval-bench'), { recursive: true });
    writeFileSync(join(dir, '.eval-bench', 'eval-bench.yaml'), 'custom');
    await runInit({ cwd: dir, ci: false });
    expect(readFileSync(join(dir, '.eval-bench', 'eval-bench.yaml'), 'utf8')).toBe('custom');
  });

  it('scaffolded eval-bench.yaml shows the verbatim DEFAULT_TEMPLATE in a comment under judge:', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    await runInit({ cwd: dir, ci: false });
    const yaml = readFileSync(join(dir, '.eval-bench', 'eval-bench.yaml'), 'utf8');

    // The scaffold must include a `template:` reference and the verbatim
    // default — so users see exactly what they're overriding when they
    // uncomment. Each non-empty line of DEFAULT_TEMPLATE must appear in
    // the YAML, prefixed by a `#` comment marker (with leading whitespace
    // for indentation under judge:). Pinning line-by-line — instead of as
    // one big string — tolerates indentation tweaks in the scaffold while
    // still catching any drift in the template body itself.
    expect(yaml).toMatch(/^\s*# template: \|/m);
    for (const line of DEFAULT_TEMPLATE.split('\n')) {
      if (line.trim() === '') continue;
      // The comment renders the body indented inside the comment, so we
      // search for the line content somewhere on a line that starts with
      // `#` (after leading whitespace).
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`^\\s*#.*${escaped}\\s*$`, 'm');
      expect(yaml, `scaffold should contain DEFAULT_TEMPLATE line: ${line}`).toMatch(re);
    }
  });
});
