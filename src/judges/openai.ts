import {
  judgeWithOpenAICompatible,
  type OpenAICompatibleJudgeOptions,
} from './openai-compatible.js';
import type { ParsedJudgment } from './parse.js';

export type OpenAIJudgeOptions = Omit<OpenAICompatibleJudgeOptions, 'endpoint'> & {
  endpoint?: string;
};

export async function judgeWithOpenAI(
  opts: OpenAIJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  return judgeWithOpenAICompatible({
    ...opts,
    endpoint: opts.endpoint ?? 'https://api.openai.com/v1',
  });
}
