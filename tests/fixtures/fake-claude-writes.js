#!/usr/bin/env node
// Stand-in for `claude -p` that changes files the way a real session can:
// it edits a tracked file and adds a new file in the plugin folder, and adds
// an untracked skills/ folder at the top of the repository (two levels up).
// It also stands in for a transcript the run saves in a snapshots folder:
// snaps/ at the top of the repository, and .eval-bench/snapshots/ in the
// plugin folder, where `eb init` puts it.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const pluginDir = args[args.indexOf('--plugin-dir') + 1];
appendFileSync(join(pluginDir, 'f'), 'changed by claude');
writeFileSync(join(pluginDir, 'new.md'), 'new');
const top = join(pluginDir, '..', '..');
mkdirSync(join(top, 'skills'), { recursive: true });
writeFileSync(join(top, 'skills', 'x.md'), 'x');
mkdirSync(join(top, 'snaps', 's1'), { recursive: true });
writeFileSync(join(top, 'snaps', 's1', 'transcript.jsonl'), '{}');
const inPlugin = join(pluginDir, '.eval-bench', 'snapshots', 's1');
mkdirSync(inPlugin, { recursive: true });
writeFileSync(join(inPlugin, 'transcript.jsonl'), '{}');
console.log('done');
process.exit(0);
