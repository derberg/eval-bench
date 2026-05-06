# Judges

A judge is the LLM that grades each output against your rubric. The choice affects cost, speed, reproducibility, and how much you can trust the signal.

## Decision tables

### Free (no metered billing)

| Judge | Cost | Speed | Reproducibility | Recommended for |
|---|---|---|---|---|
| Ollama (local) | Free | Slow (CPU) / fast (GPU) | High (pin weights) | Daily dev loop, CI |
| GitHub Models | Free tier with daily rate limits | Fast | Medium | Prototyping; cross-model second opinion |
| Claude CLI (subprocess) | $0 marginal if you already pay for Claude Code | Slow (CLI cold-start per call) | Medium | Reusing your Claude Code subscription as the judge |

### Paid (metered API)

| Judge | Cost | Speed | Reproducibility | Recommended for |
|---|---|---|---|---|
| Anthropic | Per-token | Fast | Medium (model versions drift) | Release gates |
| OpenAI | Per-token | Fast | Medium | Cross-model second opinion |
| OpenRouter | Per-token; some models have a `:free` variant | Varies by model | Varies | Trying many models behind one key |
| OpenAI-compatible | Varies — free for self-hosted (vLLM, llama.cpp), paid for Groq / Together / HF Endpoints | Varies | Varies | Custom infra |

If you're starting out, default to **Ollama**. If you don't want to install Ollama, **GitHub Models** is the next-easiest free path. Reserve paid judges for release gates where the extra signal is worth the cost.

## Customizing the judge prompt

Every judge backend (Ollama, Anthropic, OpenAI, OpenAI-compatible, OpenRouter, GitHub Models, Claude CLI) sends the same wrapping prompt around your `{prompt, output, rubric}` triple. By default it's:

```text
You are an impartial evaluator. You are given a PROMPT, an assistant's OUTPUT,
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
```

This is good enough for most evaluations. Override it when you want to inject project-specific scoring conventions, change the JSON contract for downstream parsing, or experiment with prompt-engineering improvements to the judge itself.

### Override via `eval-bench.yaml`

```yaml
judge:
  provider: ollama
  model: qwen2.5:14b
  endpoint: http://localhost:11434
  template: |
    You evaluate Cennso documentation answers. Grade the OUTPUT strictly by the RUBRIC.
    Penalize fabricated CRD names. Treat doc citations as required, not optional.

    Return ONLY one JSON line: {"score": N, "rationale": "..."}

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
```

### Override via CLI (one-off)

```bash
eb run --baseline-from v1-baseline --save-as wip --judge-template ./my-judge-prompt.txt
eb eval --ref HEAD --save-as wip --judge-template ./my-judge-prompt.txt
```

The CLI flag wins if both are set — useful when iterating on a new template without committing it to the YAML.

### Rules

- **Three placeholders are required:** `{{prompt}}`, `{{output}}`, `{{rubric}}`. eval-bench validates this at config-load time and again when `--judge-template` is read; a template missing any of them is rejected before any judge call fires (no half-run with all-zero scores).
- **The JSON contract is the parser's contract, not the template's.** Whatever you write, the judge's *response* must still be a JSON object containing `"score"` (number 0–5) and `"rationale"` (string). Templates that drop those keys break score parsing — the snapshot will record judge errors.
- **No other variables are interpolated.** `{{prompt}}`, `{{output}}`, `{{rubric}}` are it. Anything else is passed through verbatim, including stray `{{foo}}` you might write by mistake.

## Ollama (local, default for `ef init`)

```yaml
judge:
  provider: ollama
  model: qwen2.5:14b
  endpoint: http://localhost:11434
```

Recommended models by resource budget:
- 16 GB RAM, CPU only: `qwen2.5:7b-instruct` or `llama3.1:8b-instruct` (Q4)
- 32 GB RAM, CPU: `qwen2.5:14b` (Q4) — the default
- GPU available: `qwen2.5:32b` or larger

Pull once: `ollama pull qwen2.5:14b`. Then `ollama serve` (often auto-started).

## Anthropic

```yaml
judge:
  provider: anthropic
  model: claude-opus-4-7
```

Reads `ANTHROPIC_API_KEY` from env (override via `apiKeyEnv`).

**Bias warning:** using Claude to judge Claude favors Claude patterns. Fine for catching big regressions, risky for marginal A/B calls. Recommend cross-model judging for release gates.

## OpenAI

```yaml
judge:
  provider: openai
  model: gpt-4o
```

Reads `OPENAI_API_KEY` from env. Useful as a second opinion against Anthropic-judged runs.

## OpenAI-compatible

For Groq, Together, HuggingFace Inference Endpoints, vLLM, llama.cpp's HTTP server, etc.

```yaml
judge:
  provider: openai-compatible
  model: mistralai/Mistral-7B-Instruct-v0.3
  endpoint: https://your-endpoint/v1
  apiKeyEnv: HF_TOKEN
```

The client POSTs to `{endpoint}/chat/completions` and parses `choices[0].message.content` as JSON.

## OpenRouter

OpenRouter is an aggregator: one API key, many models (open-source and proprietary), some with a free tier. It speaks the OpenAI chat-completions wire format.

```yaml
judge:
  provider: openrouter
  model: meta-llama/llama-3.3-70b-instruct
  # endpoint: defaults to https://openrouter.ai/api/v1
  # apiKeyEnv: defaults to OPENROUTER_API_KEY
```

Reads `OPENROUTER_API_KEY` from env. Useful when:
- you want to try multiple judge models without juggling keys
- a model has a `:free` variant (append `:free` to the model id)
- you don't have GPU for local models and don't want to commit to one vendor

`provider: openrouter` is a thin convenience over `openai-compatible` with the OpenRouter base URL pre-filled — you can also use `openai-compatible` explicitly if you need custom headers or a self-hosted gateway.

## GitHub Models

GitHub Models exposes many hosted models (GPT-4o, Llama 3.1, Mistral, Phi, etc.) behind one OpenAI-compatible endpoint, with a free tier limited by daily rate quotas.

```yaml
judge:
  provider: github-models
  model: openai/gpt-4o
  # endpoint: defaults to https://models.github.ai/inference
  # apiKeyEnv: defaults to GITHUB_TOKEN
```

Setup:
1. Create a GitHub fine-grained personal access token with the **`models:read`** permission.
2. Export it as `GITHUB_TOKEN` (or set `apiKeyEnv` to whatever name you prefer).

Note: this is **not** the same thing as a GitHub Copilot subscription. GitHub Models is a separate, free-tier inference service available to any GitHub account; Copilot Chat does not currently expose an arbitrary inference API. If you only need a free Claude-quality judge and you already have a Claude Code subscription, see `claude-cli` below.

## Claude CLI

Reuses your local `claude` binary as the judge — no API key, no extra bill, but each judgment spawns a subprocess so it's slower than HTTP-based judges.

```yaml
judge:
  provider: claude-cli
  model: claude-opus-4-7    # or claude-sonnet-4-6, etc.; passed via --model
```

How it works: the judge prompt (rubric + plugin output + original prompt) is built locally and passed to `claude -p "<judge prompt>"`. Stdout is parsed as JSON the same way the HTTP judges parse their responses. Auth is whatever Claude Code is already signed in with on your machine (subscription, OAuth, etc.).

Tradeoffs vs. `provider: anthropic`:
- **Cost:** $0 if you already have a Claude Code subscription. The Anthropic API charges per token separately.
- **Speed:** much slower — each judgment is a CLI cold-start + tool-loading overhead. Expect tens of seconds per judgment.
- **Reproducibility:** medium. The CLI may be running a different model version than the API; the snapshot records `judgeModel` but Claude Code's version drift is opaque.
- **Tool isolation:** the rubric prompt instructs the judge to return JSON only, but Claude Code may still attempt tool calls. Keep rubrics tight and don't include `--allowed-tools` in `provider.extraArgs` since that affects the runner, not the judge.

Use this for solo / hobby projects where you already pay for Claude Code and want a Claude-quality judge without a separate API bill. For CI, prefer Ollama (faster, no auth state to manage).

## Quality cliff: don't go below 7B

3B-class models fail at structured output (JSON parsing) and rubric-following often enough to produce noise that *looks* like signal. Stick to 7B+ instruction-tuned models. The default `qwen2.5:14b` is a good floor.

## Reproducibility

Local judges with pinned weights are *more* reproducible than hosted ones — Anthropic and OpenAI rotate model revisions silently. The snapshot records `judge.provider` and `judge.model`; if you compare snapshots produced by different model versions, treat the comparison cautiously.

## Cross-model judging for release gates

A practical pattern:
- Daily dev loop: cheap local judge (`qwen2.5:14b`).
- Pre-release: re-run the eval set with a heavier judge (Claude Opus or GPT-4o).
- Compare both judgments. If they agree, ship. If they disagree, investigate.

The tool currently runs one judge per snapshot; for cross-judging, run twice with different `--judge` overrides and `ef compare` the resulting snapshots.
