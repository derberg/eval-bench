import { buildJudgePrompt } from './rubric.js';
import { parseJudgeResponse, type ParsedJudgment } from './parse.js';

export interface OllamaJudgeOptions {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  prompt: string;
  output: string;
  rubric: string;
}

export async function judgeWithOllama(
  opts: OllamaJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  const body = {
    model: opts.model,
    stream: false,
    options: { temperature: opts.temperature, num_predict: opts.maxTokens },
    messages: [{ role: 'user', content: buildJudgePrompt(opts) }],
    format: 'json',
  };
  const res = await fetch(`${opts.endpoint.replace(/\/+$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`ollama: HTTP ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const raw = data.message?.content ?? '';
  const parsed = parseJudgeResponse(raw);
  return { ...parsed, raw };
}
