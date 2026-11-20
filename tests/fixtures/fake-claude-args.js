#!/usr/bin/env node
// Stand-in for `claude -p` that echoes its argv (after the script path) and
// the claude.ai-connector env switch, so tests can assert isolation flags.
console.log(
  JSON.stringify({
    args: process.argv.slice(2),
    claudeAiMcp: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null,
  }),
);
process.exit(0);
