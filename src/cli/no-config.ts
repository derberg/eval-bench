import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { err } from '../logger.js';
import type { Config, JudgeProvider } from '../types.js';

const HEAD = chalk.cyan.bold;
const STEP = chalk.bold;
const SUBTLE = chalk.dim;
const EXAMPLE = chalk.gray;
const ARROW = chalk.cyan('  › ');
const TICK = chalk.green('  ✓ ');
const CROSS = chalk.red('  ✗ ');
const RULE = chalk.dim('  ──────────────────────────────────────────────\n');

const VALID_PROVIDERS: JudgeProvider[] = [
  'anthropic',
  'openai',
  'openai-compatible',
  'openrouter',
  'github-models',
  'ollama',
  'claude-cli',
];
const JUDGE_SPEC_RE = /^([a-z-]+):(.+)$/;
const DEFAULT_JUDGE = 'claude-cli:claude-haiku-4-5-20251001';
const SHORTHANDS: Record<string, string> = {
  haiku: 'claude-cli:claude-haiku-4-5-20251001',
  sonnet: 'claude-cli:claude-sonnet-4-6',
  opus: 'claude-cli:claude-opus-4-7',
};

export type NoConfigResult =
  | { action: 'init' }
  | { action: 'inline'; config: Config }
  | { action: 'error' };

// Called when eval-bench run finds no config file.
// Non-interactive (--no-tty or non-TTY): prints a helpful error and
// returns { action: 'error' }.
// Interactive TTY: prompts the user to either init or run a one-time inline
// prompt, collecting the judge spec for the inline path.
//
// Each run always gets its own isolated cwd. A project/ symlink inside that
// cwd points to the current directory so Claude can read source files directly
// without Bash navigation, while runs stay isolated from each other.
export function handleMissingConfig(
  configPath: string,
  noInteractive: boolean,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<NoConfigResult> {
  if (noInteractive || !('isTTY' in input) || !(input as NodeJS.ReadStream).isTTY) {
    err(`Config file not found: ${configPath}`);
    err(`  Run \`eval-bench init\` to scaffold a benchmark config, or`);
    err(`  run \`eval-bench run --prompt-inline\` to try a one-time inline prompt.`);
    err(`  Pass \`--config <path>\` to load a config from a custom location.`);
    return Promise.resolve({ action: 'error' });
  }

  return new Promise<NoConfigResult>((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    let phase: 'menu' | 'judge' = 'menu';
    let resolved = false;

    output.write('\n');
    output.write(HEAD('  ✦ eval-bench') + SUBTLE(` · no config found at ${configPath}\n`));
    output.write(RULE);
    output.write(SUBTLE('  What would you like to do?\n\n'));
    output.write(`  ${chalk.bold('1')} ${SUBTLE('·')} init   — scaffold .eval-bench/eval-bench.yaml and prompts.yaml\n`);
    output.write(`  ${chalk.bold('2')} ${SUBTLE('·')} inline — run a one-time prompt without a config file\n`);
    output.write('\n');
    output.write(ARROW);

    rl.on('line', (line) => {
      const choice = line.trim();

      if (phase === 'menu') {
        if (choice === '1' || choice.toLowerCase() === 'init') {
          resolved = true;
          rl.close();
          output.write(TICK + 'init\n\n');
          resolve({ action: 'init' });
          return;
        }
        if (choice === '2' || choice.toLowerCase() === 'inline') {
          phase = 'judge';
          output.write(TICK + 'inline\n');
          output.write('\n');
          output.write(STEP('  Judge') + SUBTLE(' · provider:model\n'));
          output.write(SUBTLE('    Press enter for ') + EXAMPLE(DEFAULT_JUDGE) + '\n');
          output.write(
            SUBTLE('    Shorthands: ') +
              EXAMPLE(Object.keys(SHORTHANDS).join(', ')) +
              SUBTLE('  or full ') +
              EXAMPLE('ollama:qwen2.5:14b') +
              '\n',
          );
          output.write(ARROW);
          return;
        }
        output.write(CROSS + SUBTLE('enter 1 (init) or 2 (inline)\n'));
        output.write(ARROW);
        return;
      }

      if (phase === 'judge') {
        const raw = choice === '' ? DEFAULT_JUDGE : (SHORTHANDS[choice.toLowerCase()] ?? choice);
        const m = raw.match(JUDGE_SPEC_RE);
        if (!m || !VALID_PROVIDERS.includes(m[1] as JudgeProvider)) {
          output.write(
            CROSS +
              SUBTLE(`must be provider:model — provider one of: ${VALID_PROVIDERS.join(', ')}\n`),
          );
          output.write(ARROW);
          return;
        }
        const [, provider, model] = m;
        resolved = true;
        rl.close();
        output.write(TICK + SUBTLE('judge = ') + chalk.bold(raw) + '\n\n');
        const config: Config = {
          plugin: { path: './', gitRoot: './' },
          provider: {
            command: 'claude',
            extraArgs: [],
            timeout: 800,
            model: null,
            allowedTools: null,
            cwd: '{{snapshots_dir}}/{{snapshot_name}}/{{variant}}/{{prompt_id}}/{{sample}}',
          },
          judge: {
            provider: provider as JudgeProvider,
            model,
            endpoint: null,
            apiKeyEnv: null,
            temperature: 0,
            maxTokens: 1024,
            template: null,
          },
          runs: { samples: 3, parallel: 1 },
          snapshots: { dir: './.eval-bench/snapshots' },
        };
        resolve({ action: 'inline', config });
        return;
      }
    });

    rl.on('close', () => {
      if (!resolved) {
        resolve({ action: 'error' });
      }
    });
  });
}
