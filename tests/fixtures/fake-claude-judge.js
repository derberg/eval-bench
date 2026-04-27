#!/usr/bin/env node
// Stand-in for `claude -p` when used as a judge: prints a fixed JSON judgment.
console.log(JSON.stringify({ score: 4, rationale: 'looks fine' }));
process.exit(0);
