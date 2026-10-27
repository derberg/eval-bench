#!/usr/bin/env node
// Stand-in for a `claude -p --output-format stream-json` session that resumes
// after its first answer (a background subagent finished), so stdout carries
// two result events. Token usage is per segment; total_cost_usd is cumulative.
// The second segment ends on a tool call, so its result text is empty.
const events = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'First answer.' }] } },
  {
    type: 'result',
    subtype: 'success',
    result: 'First answer.',
    total_cost_usd: 0.5,
    usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 1000 },
  },
  { type: 'system', subtype: 'init' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Follow-up after the subagent returned.' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: {} }] } },
  {
    type: 'result',
    subtype: 'success',
    result: '',
    total_cost_usd: 0.8,
    usage: { input_tokens: 2, output_tokens: 20, cache_read_input_tokens: 200, cache_creation_input_tokens: 2000 },
  },
];
for (const ev of events) console.log(JSON.stringify(ev));
process.exit(0);
