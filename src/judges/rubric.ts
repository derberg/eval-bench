import { createHash } from 'node:crypto';

const TEMPLATE = `You are an impartial evaluator. You are given a PROMPT, an assistant's OUTPUT,
and a RUBRIC describing what a good output looks like. Grade the OUTPUT strictly by
the RUBRIC.

Return ONLY a JSON object on a single line with exactly these fields:
  "score":     number in [0, 5]  (can be fractional, e.g. 3.5)
  "rationale": string (1-3 sentences explaining the score)

Do not include any other text.

-----
PROMPT:
{{prompt}}
-----
OUTPUT:
{{output}}
-----
RUBRIC:
{{rubric}}
-----
`;

export function buildJudgePrompt(opts: { prompt: string; output: string; rubric: string }): string {
  return TEMPLATE.replace('{{prompt}}', opts.prompt)
    .replace('{{output}}', opts.output)
    .replace('{{rubric}}', opts.rubric);
}

export function hashRubric(rubric: string): string {
  return createHash('sha256').update(rubric).digest('hex');
}
