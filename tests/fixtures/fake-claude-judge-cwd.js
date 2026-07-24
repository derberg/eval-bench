#!/usr/bin/env node
// Stand-in judge that reports its working directory as the rationale, so
// tests can verify the cwd the judge subprocess was spawned in.
console.log(JSON.stringify({ score: 4, rationale: process.cwd() }));
