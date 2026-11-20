#!/usr/bin/env node
// Stand-in judge that reports its argv and the claude.ai-connector env switch
// as the rationale, so tests can assert the judge is started isolated.
const rationale = JSON.stringify({
  args: process.argv.slice(2),
  claudeAiMcp: process.env.ENABLE_CLAUDEAI_MCP_SERVERS ?? null,
});
console.log(JSON.stringify({ score: 4, rationale }));
