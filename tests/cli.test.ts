import { describe, it, expect } from 'vitest';
import { execa } from 'execa';

describe('cli', () => {
  it('prints help with --help', async () => {
    const result = await execa('npx', ['tsx', 'src/cli/index.ts', '--help']);
    expect(result.stdout).toMatch(/Usage: eval-bench/);
    expect(result.stdout).toMatch(/init/);
    expect(result.stdout).toMatch(/run/);
    expect(result.stdout).toMatch(/compare/);
  });

  it('prints version with --version matching package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const result = await execa('npx', ['tsx', 'src/cli/index.ts', '--version']);
    expect(result.stdout.trim()).toBe(pkg.version);
  });
});
