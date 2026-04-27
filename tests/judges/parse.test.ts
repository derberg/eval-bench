import { describe, it, expect } from 'vitest';
import { parseJudgeResponse } from '../../src/judges/parse.js';

describe('parseJudgeResponse', () => {
  it('parses a well-formed JSON response', () => {
    const { score, rationale } = parseJudgeResponse('{"score": 4.2, "rationale": "good"}');
    expect(score).toBe(4.2);
    expect(rationale).toBe('good');
  });

  it('extracts JSON from a fenced block', () => {
    const input = 'Sure!\n```json\n{"score": 3, "rationale": "ok"}\n```\n';
    const { score } = parseJudgeResponse(input);
    expect(score).toBe(3);
  });

  it('throws on malformed output', () => {
    expect(() => parseJudgeResponse('not json')).toThrow(/parse/i);
  });

  it('clamps score to 0..5 range', () => {
    expect(parseJudgeResponse('{"score": 9, "rationale": "x"}').score).toBe(5);
    expect(parseJudgeResponse('{"score": -2, "rationale": "x"}').score).toBe(0);
  });
});
