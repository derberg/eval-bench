export interface ParsedJudgment {
  score: number;
  rationale: string;
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export function parseJudgeResponse(raw: string): ParsedJudgment {
  let candidate = raw.trim();
  const fenceMatch = candidate.match(FENCE_RE);
  if (fenceMatch) {
    candidate = fenceMatch[1].trim();
  } else {
    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = candidate.slice(firstBrace, lastBrace + 1);
    }
  }
  let obj: unknown;
  try {
    obj = JSON.parse(candidate);
  } catch (err) {
    throw new Error(`judge response: could not parse JSON (${(err as Error).message})`);
  }
  if (typeof obj !== 'object' || obj === null) {
    throw new Error('judge response: JSON root must be an object');
  }
  const { score, rationale } = obj as { score?: unknown; rationale?: unknown };
  if (typeof score !== 'number' || Number.isNaN(score)) {
    throw new Error('judge response: missing or non-numeric "score"');
  }
  if (typeof rationale !== 'string') {
    throw new Error('judge response: missing string "rationale"');
  }
  const clamped = Math.max(0, Math.min(5, score));
  return { score: clamped, rationale };
}
