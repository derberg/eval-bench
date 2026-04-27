import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('tool CI', () => {
  it('runs npm ci, test, and build', () => {
    const w = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(w).toMatch(/npm ci/);
    expect(w).toMatch(/npm test/);
    expect(w).toMatch(/npm run build/);
  });
});
