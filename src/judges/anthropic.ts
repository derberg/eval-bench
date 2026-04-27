import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';

export interface AnthropicJudgeOptions {
  baseUrl?: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  prompt: string;
  output: string;
  rubric: string;
}

export async function judgeWithAnthropic(
  opts: AnthropicJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const base = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
  const res = await fetch(`${base}/v1/messages`, {
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
    throw new Error(`anthropic: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const raw = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
  const parsed = parseJudgeResponse(raw);
  return { ...parsed, raw };
}
