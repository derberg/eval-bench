import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('README', () => {
  it('has a quickstart, install, and link to docs', () => {
    const r = readFileSync('README.md', 'utf8');
    expect(r).toMatch(/## Install/);
    expect(r).toMatch(/## Quickstart/);
    expect(r).toMatch(/docs\/quickstart\.md/);
    expect(r).toMatch(/docs\/judges\.md/);
  });
});
