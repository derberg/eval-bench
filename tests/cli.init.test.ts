import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/cli/init.js';

describe('ef init', () => {
  it('writes evalforge.yaml, prompts.yaml, snapshots/.gitkeep', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    await runInit({ cwd: dir, ci: false });
    expect(existsSync(join(dir, '.evalforge', 'evalforge.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.evalforge', 'prompts.yaml'))).toBe(true);
    expect(existsSync(join(dir, '.evalforge', 'snapshots', '.gitkeep'))).toBe(true);
    expect(readFileSync(join(dir, '.evalforge', 'evalforge.yaml'), 'utf8')).toContain('judge:');
  });

  it('emits GH Actions workflow with --ci', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    await runInit({ cwd: dir, ci: true });
    expect(existsSync(join(dir, '.github', 'workflows', 'evalforge.yml'))).toBe(true);
  });

  it('does not overwrite existing files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ef-init-'));
    mkdirSync(join(dir, '.evalforge'), { recursive: true });
    writeFileSync(join(dir, '.evalforge', 'evalforge.yaml'), 'custom');
    await runInit({ cwd: dir, ci: false });
    expect(readFileSync(join(dir, '.evalforge', 'evalforge.yaml'), 'utf8')).toBe('custom');
  });
});
