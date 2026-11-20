#!/usr/bin/env node
// Stand-in for `claude -p` that changes files the way a real session can:
// it edits a tracked file and adds a new file in the plugin folder, and adds
// an untracked skills/ folder at the top of the repository (two levels up).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const pluginDir = args[args.indexOf('--plugin-dir') + 1];
appendFileSync(join(pluginDir, 'f'), 'changed by claude');
writeFileSync(join(pluginDir, 'new.md'), 'new');
const top = join(pluginDir, '..', '..');
mkdirSync(join(top, 'skills'), { recursive: true });
writeFileSync(join(top, 'skills', 'x.md'), 'x');
console.log('done');
process.exit(0);
