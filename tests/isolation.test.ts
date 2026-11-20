import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { isolationMismatch } from '../src/isolation.js';

const isolated = { isolation: true, claudeAiConnectors: false, extraPlugins: [] as string[], extraArgs: [] as string[] };

describe('isolationMismatch', () => {
  it('returns null when both sides ran with the same isolation settings', () => {
    expect(isolationMismatch(isolated, { ...isolated })).toBeNull();
  });

  it('treats a snapshot from before 0.28 (no isolation fields) as loading everything', () => {
    expect(isolationMismatch({ extraArgs: [] }, isolated)).toMatch(/all setting sources/);
  });

  it('a snapshot from before 0.28 with --setting-sources project differs from 0.28 only in the connectors', () => {
    const old = { extraArgs: ['--setting-sources', 'project'] };
    const now = { ...isolated, extraArgs: ['--setting-sources', 'project'] };
    const diff = isolationMismatch(old, now);
    expect(diff).toMatch(/claude\.ai connectors on/);
    expect(diff).toMatch(/claude\.ai connectors off/);
  });

  it('describes a user --setting-sources by its value, in either form', () => {
    const user = { ...isolated, extraArgs: ['--setting-sources=user,project'] };
    expect(isolationMismatch(user, isolated)).toMatch(/user,project/);
  });

  it('reports a difference in claude.ai connectors or extra plugins', () => {
    expect(isolationMismatch({ ...isolated, claudeAiConnectors: true }, isolated)).toMatch(/connectors on/);
    expect(isolationMismatch({ ...isolated, extraPlugins: ['/x'] }, isolated)).toMatch(/\/x/);
  });

  it('compares extra plugins by their resolved path', () => {
    expect(
      isolationMismatch({ ...isolated, extraPlugins: ['./foo'] }, { ...isolated, extraPlugins: [resolve('foo')] }),
    ).toBeNull();
  });
});
