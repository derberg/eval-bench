import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

describe('project hygiene', () => {
  it('has a .gitignore that excludes dist and node_modules', () => {
    expect(existsSync('.gitignore')).toBe(true);
    const contents = readFileSync('.gitignore', 'utf8');
    expect(contents).toMatch(/node_modules/);
    expect(contents).toMatch(/dist/);
  });
  it('has a README', () => {
    expect(existsSync('README.md')).toBe(true);
  });
  it('has a LICENSE', () => {
    expect(existsSync('LICENSE')).toBe(true);
  });
});
