import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';
import type { DebugLogger } from '../debug.js';
import { noopDebug } from '../debug.js';

export interface OpenAICompatibleJudgeOptions {
  endpoint: string;
  apiKey: string | null;
  model: string;
  temperature: number;
  maxTokens: number;
  prompt: string;
  output: string;
  rubric: string;
  debug?: DebugLogger;
}

export async function judgeWithOpenAICompatible(
  opts: OpenAICompatibleJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const debug = opts.debug ?? noopDebug();
  const base = opts.endpoint.replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.apiKey) {
    headers['authorization'] = `Bearer ${opts.apiKey}`;
  }
  const { res, bodyText } = await debug.fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: buildJudgePrompt(opts) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`openai-compatible: HTTP ${res.status} ${bodyText}`);
  }
  const data = JSON.parse(bodyText) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const parsed = parseJudgeResponse(raw);
  return { ...parsed, raw };
}
