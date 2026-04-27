import {
  judgeWithOpenAICompatible,
  type OpenAICompatibleJudgeOptions,
} from './openai-compatible.js';
import type { ParsedJudgment } from './parse.js';

export type GithubModelsJudgeOptions = Omit<OpenAICompatibleJudgeOptions, 'endpoint'> & {
  endpoint?: string;
};

export async function judgeWithGithubModels(
  opts: GithubModelsJudgeOptions,
): Promise<ParsedJudgment & { raw: string }> {
  return judgeWithOpenAICompatible({
    ...opts,
    endpoint: opts.endpoint ?? 'https://models.github.ai/inference',
  });
}
