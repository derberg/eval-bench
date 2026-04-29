import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';
import type { DebugLogger } from '../debug.js';
import { noopDebug } from '../debug.js';

export interface AnthropicJudgeOptions {
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  prompt: string;
  output: string;
  rubric: string;
  debug?: DebugLogger;
}

export async function judgeWithAnthropic(
  opts: AnthropicJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const debug = opts.debug ?? noopDebug();
  const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const { res, bodyText } = await debug.fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      messages: [{ role: 'user', content: buildJudgePrompt(opts) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic: HTTP ${res.status} ${bodyText}`);
  }
  const data = JSON.parse(bodyText) as { content?: Array<{ type: string; text?: string }> };
  const raw = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  const parsed = parseJudgeResponse(raw);
  return { ...parsed, raw };
}
