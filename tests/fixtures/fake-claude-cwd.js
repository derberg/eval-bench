#!/usr/bin/env node
// Stand-in for `claude -p` that writes a marker file in cwd and prints
// process.cwd(), so tests can verify the working directory the provider
// spawned us in. Reads the prompt purely so error paths still echo it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
writeFileSync(join(process.cwd(), 'artifact.txt'), `prompt=${prompt}\n`);
console.log(`[CWD=${process.cwd()}] ${prompt}`);
process.exit(0);
