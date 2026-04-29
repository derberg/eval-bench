# `--debug` flag + Ollama streaming

Status: design

## Problem

Judging on local Ollama with `qwen2.5:72b-instruct-q4_0` recently started exceeding eb's effective 5-minute HTTP timeout. Before, judge calls finished in ~1.5 min. Now they cancel at exactly 5 min and `--retry-failed` repeats the same dead-end against every previously-failed row, ~5 min per row.

The 5-minute wall is undici's default `headersTimeout` / `bodyTimeout` (300_000 ms). eb's [src/judges/ollama.ts](../../src/judges/ollama.ts) calls bare `fetch()` with no signal/dispatcher, so the default applies. Worse: with `stream: false`, Ollama only returns headers after generation completes, so a slow generation hits the headers timeout before producing any signal at all — including the diagnostic timing fields (`prompt_eval_count/duration`, `eval_count/duration`, `total_duration`) that would tell us *which part* got slower.

The user can't tell *what changed*. We have no visibility into:
- whether the judge prompt content/size grew
- whether prompt processing (prefill) got slower
- whether token-generation rate dropped
- whether the rubric or prompt content drifted between runs

## Goals

- Add `--debug` to `eb run` and `eb eval` that produces a structured, diff-able log of the entire pipeline plus full HTTP/provider request and response bodies.
- Switch the Ollama judge to streaming so (a) per-chunk activity resets undici's bodyTimeout (no more 5-min wall on legitimate slow generation) and (b) on timeout/cancel we still know how many tokens were generated.
- Surface Ollama's diagnostic timing fields in the debug log so a fast snapshot's log can be `diff`ed against a slow snapshot's log to localize the regression.

## Non-goals

- Live streaming of the `claude` subprocess stdout. Provider-side timing isn't the bottleneck and rewriting `provider.ts` to stream is a separate concern.
- A `--debug-quiet` mode. `2>/dev/null` works.
- A configurable `judge.timeout`. Streaming removes the timeout pressure for Ollama; for cloud judges undici's 5 min is fine.
- `--debug` on `eb compare` / `eb view` / `eb snapshot` — they don't execute the matrix.
- Body-content secret scanning. Only headers are redacted.

## Design

### User-facing surface

Two changes:

1. **`--debug`** boolean flag on `eb run` and `eb eval`. When set:
   - eb writes `./.eval-bench/snapshots/<name>/debug-<ISO-timestamp>.log` (one file per invocation; never overwrites)
   - the same events are mirrored to **stderr** in color, with bodies truncated to head-1KB + tail-512B for readability
   - file always contains untruncated bodies and no ANSI codes
2. **Ollama judge switches to `stream: true`** unconditionally. Behavior change is invisible in normal output; diagnostic upside is large.

### Event catalog

Each event is one line:

```
<ISO-timestamp> [<event>] key=value key=value ...
                          body: <inline body or "[N bytes elided]">
```

| event | when | fields |
|---|---|---|
| `config-loaded` | once at start | configPath, judge.provider, judge.model, judge.maxTokens, runs.parallel, runs.samples |
| `prompts-loaded` | once | count, paths |
| `matrix-built` | once | rows, variants, samples |
| `resume-loaded` | when resuming/--retry-failed/--baseline-from | snapshot, runsKept, judgmentsKept, freshRows, reJudgeRows |
| `run-start` | per row | rowId, variant, prompt, sample, cwd, command, args, promptHash |
| `run-end` | per row | rowId, exitCode, durationMs, outputBytes, inputTokens, outputTokens, error? |
| `judge-start` | per row | rowId, promptBytes, rubricHash |
| `http-req` | per HTTP call | method, url, headers (redacted), bodyBytes, body |
| `http-chunk` | per N streamed chunks (Ollama only) | url, chunkCount, bytesSoFar, tokensSoFar |
| `http-res` | per HTTP call | status, durationMs, headers, bodyBytes, body |
| `judge-end` | per row | rowId, score, rawBytes, ollamaTimings? (`promptEvalCount`, `promptEvalMs`, `evalCount`, `evalMs`, `totalMs`), error? |
| `checkpoint` | per snapshot write | runs, judgments, complete |
| `snapshot-saved` | once at end | path, runs, judgments, complete |

`http-chunk` heartbeat fires every 32 chunks (≈32 tokens) for Ollama streaming so the log shows liveness during long generation. The fields are computed from accumulated chunks.

`judge-end.ollamaTimings` is populated from the final streaming chunk (which carries `done:true` plus all the timing fields). On timeout/cancel the field is omitted but `http-chunk` history shows how far we got.

`promptHash` is `sha256(rowPrompt).slice(0, 16)` — short enough to read inline, stable enough to detect drift. Same idea as the existing `rubricHash`.

### Truncation

- **File**: full bodies. No truncation, no colors.
- **Stderr**: bodies/outputs > 2KB show first 1KB + last 512B with `... [N bytes elided] ...`. Always shows `bodyBytes=` so growth is spottable at a glance.

### Secret redaction

Both stderr and file: `Authorization`, `X-Api-Key`, `Anthropic-Api-Key`, `Openai-Api-Key` header values replaced with `<redacted>`. Case-insensitive match. Body content is not scanned.

### Color scheme (stderr only)

- timestamps and `[event-name]` dim
- `run-end` / `judge-end`: green when no error, red on error
- `http-res` status: 2xx green, 3xx yellow, 4xx/5xx red
- error lines red
- everything else default

### Code structure

New module: **`src/debug.ts`**

```typescript
export interface DebugLogger {
  event(name: string, fields: Record<string, unknown>, body?: string): void;
  // wraps fetch; logs http-req, optionally streams http-chunk events,
  // logs http-res; returns Response (or stream-aware shape)
  fetch(url: string, init: RequestInit, ctx?: { onStreamChunk?: (text: string) => void }): Promise<Response>;
  close(): Promise<void>;
}

export function initDebug(opts: { snapshotDir: string; name: string }): DebugLogger;
export function noopDebug(): DebugLogger;
```

`runBenchmark` (and the CLI runners that call it) take an optional `debug?: DebugLogger`. When `--debug` is unset, `noopDebug()` is wired in — same call sites, zero output. Callers don't branch on `if (debug)` everywhere.

### Concurrency

`DebugLogger.event` queues writes through a single `writeChain: Promise<void>` (same pattern as `runBenchmark`'s checkpoint chain in [src/run.ts](../../src/run.ts)). Concurrent rows can't interleave mid-line.

### Instrumentation points

- **`src/cli/run.ts`** / **`src/cli/eval.ts`**: parse flag, init logger, emit `config-loaded`, `prompts-loaded`, `resume-loaded`, `snapshot-saved`. Pass logger into `runBenchmark`.
- **`src/run.ts`** `runBenchmark`: emit `matrix-built`, `checkpoint`. Pass logger into `runAndJudge` / `judgeRun`. Emit `run-start`, `run-end`, `judge-start`, `judge-end`.
- **`src/judges/*.ts`**: replace bare `fetch(...)` with `debug.fetch(...)` (the noop logger calls plain fetch under the hood).
- **`src/judges/ollama.ts`**: switch to `stream: true`. Read NDJSON line-by-line from `res.body`, accumulate `message.content`, emit `http-chunk` heartbeat every 32 chunks, capture timing fields from the final `done:true` chunk. Return the same `{ score, rationale, raw }` shape as today plus `ollamaTimings`.
- **`src/provider.ts`**: log `run-start` (command, args, cwd) before `execa`, `run-end` (exit, duration, output bytes, usage) after.

### Streaming details (Ollama judge)

Request body adds `stream: true` and keeps `format: 'json'` (Ollama applies the format constraint to the accumulated response). `parseJudgeResponse` is tolerant of either constrained JSON or prose-wrapped JSON, so this is robust.

Response handling: `res.body` is `ReadableStream<Uint8Array>`. Decode with `TextDecoder('utf-8')`, split by `\n`, parse each line as JSON. Accumulate `message.content`. On the final chunk (`done:true`), capture:
- `prompt_eval_count`, `prompt_eval_duration` (ns → ms)
- `eval_count`, `eval_duration` (ns → ms)
- `total_duration` (ns → ms)

Errors that come mid-stream (e.g. `{ "error": "..." }`) are surfaced as a thrown `Error('ollama: ...')` matching today's behavior.

### Failure modes

- Filesystem can't write `debug-<ts>.log`: log a warning to stderr, fall back to noop logger, continue.
- Stream parse error mid-chunk: throw `Error('ollama: invalid stream chunk: ...')`. Caught by the existing judge error handler in [src/run.ts](../../src/run.ts).
- `Ctrl-C` mid-run: `appendFile` flushes per call, no explicit close needed; partial log is valid.
- `--debug` on a command that doesn't accept it: `commander` rejects with usage error.

### Testing

- `tests/debug.test.ts`: noop logger emits nothing; init logger writes well-formed lines; concurrent events serialize; redaction works; truncation rule for stderr only.
- `tests/judges.ollama.test.ts` (new or extended): mock `fetch` returning a `ReadableStream` of NDJSON chunks; assert accumulated content, captured timing fields, error path.
- `tests/cli.debug.test.ts`: integration — `eb run --debug` against a stub judge produces a `debug-*.log` with the expected event sequence.

### Documentation

- `CHANGELOG.md`: feat entry (likely v0.6.1).
- `docs/troubleshooting.md`: add a "Diagnosing slow Ollama judging" section that points at `--debug` and the timing fields.
- `README.md`: one-line mention of `--debug`.

## Open questions

None — bundled streaming + debug, file location confirmed, timing fields under `--debug` only.
