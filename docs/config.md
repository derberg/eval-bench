# Config reference

Two config files live in your plugin repo under `.eval-bench/`: `eval-bench.yaml` (settings) and `prompts.yaml` (eval prompts + rubrics).

## eval-bench.yaml

### plugin

```yaml
plugin:
  path: ./           # default: cwd
  gitRoot: ./        # optional; default = plugin.path
```

- `path` — directory containing the plugin (`.claude-plugin/plugin.json` or skills/agents/etc).
- `gitRoot` — git repo root for the plugin. Worktrees are created relative to this. Defaults to `plugin.path`.

### provider

How to invoke Claude Code.

```yaml
provider:
  command: claude          # default: claude on PATH
  extraArgs: []            # extra args appended before `-p <prompt>`
  timeout: 180             # seconds per prompt; default: 180
  model: claude-opus-4-7   # passed via --model; null for default
  allowedTools: null       # array of tool names, or null (default)
  cwd: "{{snapshots_dir}}/{{snapshot_name}}/{{variant}}/{{prompt_id}}/{{sample}}"  # default
```

#### Session isolation — strongly recommended `extraArgs`

```yaml
provider:
  extraArgs: ["--setting-sources", "project"]
```

Without it, the benchmarked session inherits the runner machine's entire global Claude Code environment — every user-installed plugin and MCP server. In one measured case that meant 108 tools / 10 MCP servers in context instead of 42 / 2: roughly 10k extra initial-context tokens re-read on every turn (~10–20% higher cost per run), scores that depend on whose machine ran the eval, and unrelated tools leaking into outputs (judges have docked points for stray "unrelated MCP servers" notes). With `--setting-sources project`, only built-ins, the plugin under test (loaded via `--plugin-dir`), and the plugin's own `.mcp.json` servers are present. The `eb init` scaffold sets this by default; remove it only if your plugin genuinely depends on user-level settings.

#### `cwd` — per-sample working directory

Each Claude invocation runs in its own directory so any files the model writes (`.likec4` diagrams, generated code, scratch outputs) land alongside `snapshot.json` instead of polluting your repo. The directory is created on first use, and the resolved path is recorded on every run in `snapshot.json` (`runs[].cwd`) so judges and post-hoc inspection can find the artifacts.

The default — `{{snapshots_dir}}/{{snapshot_name}}/{{variant}}/{{prompt_id}}/{{sample}}` — drops artifacts as siblings of the snapshot's `snapshot.json`. Override it with any path template you like.

Supported template variables:

| variable             | resolves to                                                       |
| -------------------- | ----------------------------------------------------------------- |
| `{{snapshots_dir}}`  | `snapshots.dir` from this config                                  |
| `{{snapshot_name}}`  | the `--save-as` name for this run                                 |
| `{{variant}}`        | `baseline` or `current`                                           |
| `{{prompt_id}}`      | the prompt's `id` from `prompts.yaml`                             |
| `{{sample}}`         | 1-based sample number for this row                                |
| `{{plugin_dir}}`     | the plugin directory the row is running against (per variant)    |

Notes:
- Relative paths resolve against the `eb` process cwd.
- The recorded path is canonical (after `realpath`), so macOS `/var/folders` shows up as `/private/var/folders`.
- Set `cwd: null` to opt out and inherit the cwd of the `eb` process (legacy behavior — files the model writes land in your repo).
- Unrecognized `{{vars}}` pass through verbatim, so a typo surfaces as a literal directory name rather than silently substituting empty.

### judge

The LLM that grades each output.

```yaml
judge:
  provider: ollama                       # ollama | anthropic | openai | openai-compatible | openrouter | github-models | claude-cli
  model: qwen2.5:14b                     # provider-specific identifier
  endpoint: http://localhost:11434       # required for ollama and openai-compatible
  apiKeyEnv: ANTHROPIC_API_KEY           # env var holding API key (default per provider)
  temperature: 0
  maxTokens: 1024
  template: null                         # optional: override the wrapping judge prompt
```

`template` overrides the wrapping prompt sent around every `{prompt, output, rubric}` triple. Default is `null` (use the built-in template, see [judges.md](judges.md#customizing-the-judge-prompt) for the verbatim text). When set, the value must contain the placeholders `{{prompt}}`, `{{output}}`, `{{rubric}}` — eval-bench validates this at config-load time. Same effect as `--judge-template <path>` on the CLI; the CLI flag wins when both are set.

Defaults for `apiKeyEnv`:
- `ollama` → none (no auth)
- `anthropic` → `ANTHROPIC_API_KEY`
- `openai` → `OPENAI_API_KEY`
- `openai-compatible` → none unless you set one
- `openrouter` → `OPENROUTER_API_KEY`
- `github-models` → `GITHUB_TOKEN` (must have `models:read` scope)
- `claude-cli` → none (uses your local Claude Code auth)

`endpoint` defaults per provider:
- `openai` → `https://api.openai.com/v1`
- `anthropic` → `https://api.anthropic.com`
- `openrouter` → `https://openrouter.ai/api/v1`
- `github-models` → `https://models.github.ai/inference`
- `claude-cli` → not used (subprocess, not HTTP)

### runs

```yaml
runs:
  samples: 3      # repeats per prompt per variant
  parallel: 2     # concurrent claude invocations
```

- `samples` — more samples reduces noise but costs more time/API calls. 3–5 is typical.
- `parallel` — keep low; Anthropic API rate limits and your machine's CPU/RAM are the constraints.

### snapshots

```yaml
snapshots:
  dir: ./.eval-bench/snapshots
```

Where snapshot JSON and HTML views are written. Commit this to git if you want a historical record; otherwise it's ignored by default (`.eval-bench/` is in `.gitignore`).

## prompts.yaml

A YAML array of prompt specs. Each entry must have `id`, `prompt`, and `rubric`.

```yaml
- id: kebab-case-id
  prompt: |
    The user-facing prompt. Multi-line strings are fine.
  rubric: |
    Score 0-5 on:
    - Criterion A (0-2): ...
    - Criterion B (0-2): ...
    - Criterion C (0-1): ...
```

Rules:
- `id` must be kebab-case (`^[a-z0-9][a-z0-9-]*$`). Used in run IDs and snapshot keys.
- `id` must be unique within the file.
- `prompt` and `rubric` are required and non-empty.

See [rubrics.md](rubrics.md) for guidance on writing rubrics that produce reliable scores.

## CLI flags for `eb run`

These flags are available on every `eb run` invocation and override the corresponding config values.

| flag | description |
|------|-------------|
| `--prompt-inline` | Skip the prompts file and enter a one-shot prompt interactively. The snapshot is ephemeral (not saved to `snapshots.dir`) unless you also pass `--save-as <name>`. Implies current-variant only — no baseline. |
| `--no-tty` | Disable the interactive menu. If the config file is missing, print a helpful error and exit instead of prompting. Useful in scripts and CI. |
| `--timeout <s>` | Override `provider.timeout` for this run. Default is 800 s. Increase for prompts that ask Claude to explore and write large documents. |
| `--judge <provider:model>` | Override the judge for this run, e.g. `claude-cli:claude-haiku-4-5-20251001` or `ollama:qwen2.5:14b`. |
| `--samples <n>` | Override `runs.samples` for this run. |
| `--save-as <name>` | Name for the saved snapshot. Defaults to an ISO timestamp. |
| `--no-save` | Don't persist the snapshot to `snapshots.dir`. A temporary snapshot is still written so the file:// links work. |
| `--only <ids>` | Comma-separated list of prompt IDs to run (filters the matrix). |
| `--retry-failed` | Re-run only the failed rows in an existing snapshot. |
| `--rejudge` | Re-judge cached runs with the current judge config (skips Claude). |
| `--force` | Overwrite an existing snapshot unconditionally. |
| `--baseline <ref>` | Git ref for the baseline worktree. Default: `HEAD~1`. |
| `--current <ref>` | Git ref for the current worktree. Default: `HEAD`. |
| `--baseline-from <name>` | Reuse runs from a saved snapshot as the baseline instead of re-running Claude. |

### Inline judge shorthands

When `--judge` or the interactive menu asks for a judge spec, these shorthands expand automatically:

| shorthand | expands to |
|-----------|-----------|
| `haiku` | `claude-cli:claude-haiku-4-5-20251001` |
| `sonnet` | `claude-cli:claude-sonnet-4-6` |
| `opus` | `claude-cli:claude-opus-4-7` |
| _(enter)_ | `claude-cli:claude-haiku-4-5-20251001` (default) |

All `claude-cli` judges use your local Claude Code auth — no `ANTHROPIC_API_KEY` needed.
