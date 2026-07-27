#!/usr/bin/env node
// Stand-in for `claude -p` that echoes the value passed via --plugin-dir, so
// tests can assert the plugin is loaded through the CLI flag (not just the
// EVAL_BENCH_PLUGIN_DIR env var, which the real claude CLI ignores).
const args = process.argv.slice(2);
const flagIdx = args.indexOf('--plugin-dir');
const pluginDir = flagIdx >= 0 ? args[flagIdx + 1] : '';
const promptIdx = args.indexOf('-p');
const prompt = promptIdx >= 0 ? args[promptIdx + 1] : '';
console.log(`[PLUGIN_DIR_FLAG=${pluginDir}] ${prompt}`);
process.exit(0);
