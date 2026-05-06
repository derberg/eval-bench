import { createHash } from 'node:crypto';

// The default judge prompt template. Exported (and pinned by docs.core
// tests) so users can read the exact default they're about to override
// when setting `judge.template` in eval-bench.yaml or `--judge-template`.
//
// Required placeholders: {{prompt}}, {{output}}, {{rubric}}. Anything else
// is up to the template author. The wrapping JSON contract — `score` and
// `rationale` — is what the parser at parse.ts expects; templates that
// drop or rename those fields will produce judgment.error rows.
export const DEFAULT_TEMPLATE = `You are an impartial evaluator. You are given a PROMPT, an assistant's OUTPUT,
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

const REQUIRED_PLACEHOLDERS = ['{{prompt}}', '{{output}}', '{{rubric}}'] as const;

// Throws with a precise list of missing placeholders. We validate at
// config-load time and again when --judge-template flips the value, so the
// user gets a clear error before any judge call rather than a silent
// score-0 failure on every row.
export function validateJudgeTemplate(template: string): void {
  const missing = REQUIRED_PLACEHOLDERS.filter((p) => !template.includes(p));
  if (missing.length > 0) {
    throw new Error(
      `judge template is missing required placeholder(s): ${missing.join(', ')}. Templates must contain {{prompt}}, {{output}}, and {{rubric}}.`,
    );
  }
}

export function buildJudgePrompt(opts: {
  prompt: string;
  output: string;
  rubric: string;
  template?: string | null;
}): string {
  const tmpl = opts.template ?? DEFAULT_TEMPLATE;
  return tmpl
    .replace('{{prompt}}', opts.prompt)
    .replace('{{output}}', opts.output)
    .replace('{{rubric}}', opts.rubric);
}

export function hashRubric(rubric: string): string {
  return createHash('sha256').update(rubric).digest('hex');
}
