#!/usr/bin/env node
// Stand-in for `claude -p` that only echoes its working directory — no file
// writes, so it is safe to run inherited in the parent cwd (legacy cwd: null).
const args = process.argv.slice(2);
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
console.log(`[CWD=${process.cwd()}] ${prompt}`);
