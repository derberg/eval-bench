import {
  judgeWithOpenAICompatible,
  type OpenAICompatibleJudgeOptions,
} from './openai-compatible.js';
import type { ParsedJudgment } from './parse.js';

export type OpenRouterJudgeOptions = Omit<OpenAICompatibleJudgeOptions, 'endpoint'> & {
  endpoint?: string;
};

export async function judgeWithOpenRouter(
  opts: OpenRouterJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  return judgeWithOpenAICompatible({
    ...opts,
    endpoint: opts.endpoint ?? 'https://openrouter.ai/api/v1',
  });
}
