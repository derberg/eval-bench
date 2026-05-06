import { createInterface } from 'node:readline';
import chalk from 'chalk';
import type { PromptSpec } from '../types.js';

// Read one prompt + rubric interactively from the terminal so the user can
// iterate on a single rubric without committing to prompts.yaml. Multi-line
// fields are terminated by a line containing only "." — pragmatic choice over
// EOF (which is harder for users to find on different shells/keyboards) and
// over a fixed delimiter string (which can collide with rubric content).
//
// The prompt id must match the kebab-case shape that prompts.yaml's loader
// requires; we validate locally so the error message points at the input
// instead of bubbling up from zod inside loadPrompts.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

// Visual elements — kept in one place so the look of the inline-prompt flow
// is easy to retune without hunting through the phase machine.
const HEAD = chalk.cyan.bold;
const STEP = chalk.bold;
const SUBTLE = chalk.dim;
const EXAMPLE = chalk.gray;
const ARROW = chalk.cyan('  › ');
const TICK = chalk.green('  ✓ ');
const CROSS = chalk.red('  ✗ ');
const RULE = chalk.dim('  ──────────────────────────────────────────────\n');

// Event-based rather than `for await (const line of rl)` because readline's
// async-iterator protocol doesn't compose well with re-entering iteration
// after a break — once you stop iterating, the listener is detached and any
// already-emitted lines are dropped. A single persistent 'line' listener
// driven by a phase machine is the only shape that's reliable across Node
// versions.
export function readInlinePrompt(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<PromptSpec> {
  if ('isTTY' in input && !(input as NodeJS.ReadStream).isTTY) {
    return Promise.reject(
      new Error(
        '--prompt-inline requires an interactive terminal (TTY). Piped or redirected stdin is not supported — use --prompts <file> instead.',
      ),
    );
  }
  return new Promise<PromptSpec>((resolve, reject) => {
    const rl = createInterface({ input, output, terminal: true });
    let phase: 'id' | 'prompt' | 'rubric' = 'id';
    let id: string | null = null;
    const promptLines: string[] = [];
    const rubricLines: string[] = [];
    let resolved = false;

    // Banner
    output.write('\n');
    output.write(HEAD('  ✦ eval-bench') + SUBTLE(' · inline prompt\n'));
    output.write(RULE);

    writeStep(output, 1, 'prompt id');
    output.write(SUBTLE('    kebab-case identifier. Press enter for ') + EXAMPLE('"adhoc"') + SUBTLE('.\n'));
    output.write(ARROW);

    rl.on('line', (line) => {
      if (phase === 'id') {
        const raw = line.trim();
        const candidate = raw === '' ? 'adhoc' : raw;
        if (!ID_RE.test(candidate)) {
          output.write(CROSS + SUBTLE(`id must match ${ID_RE} — try again\n`));
          output.write(ARROW);
          return;
        }
        id = candidate;
        output.write(TICK + SUBTLE('id = ') + chalk.bold(candidate) + '\n');
        phase = 'prompt';
        writeStep(output, 2, 'prompt body');
        output.write(SUBTLE('    What a real user would send to claude. Multi-line is fine.\n'));
        output.write(SUBTLE('    Don\'t include the rubric here.\n'));
        output.write(SUBTLE('    End with ') + EXAMPLE('"."') + SUBTLE(' on its own line.\n'));
        output.write(ARROW);
        return;
      }
      if (phase === 'prompt') {
        if (line === '.') {
          if (!promptLines.join('\n').trim()) {
            output.write(CROSS + SUBTLE('prompt body cannot be empty — keep typing\n'));
            return;
          }
          output.write(
            TICK +
              SUBTLE(
                `prompt body (${promptLines.length} line${promptLines.length === 1 ? '' : 's'})\n`,
              ),
          );
          phase = 'rubric';
          writeStep(output, 3, 'rubric');
          output.write(SUBTLE('    Tells the judge how to score 0–5. Be specific —\n'));
          output.write(SUBTLE('    name sub-criteria, cap each, list penalties.\n'));
          output.write('\n');
          output.write(SUBTLE('    Example:\n'));
          output.write(EXAMPLE('      Score 0-5 on:\n'));
          output.write(EXAMPLE('      - Accuracy (0-3): correctly identifies X, grounded in docs\n'));
          output.write(EXAMPLE('      - Sourcing  (0-1): cites specific doc pages, not generic links\n'));
          output.write(EXAMPLE('      - Format    (0-1): clean structure, no filler\n'));
          output.write(EXAMPLE('      Penalty: -2 if any component name or API is fabricated.\n'));
          output.write('\n');
          output.write(SUBTLE('    End with ') + EXAMPLE('"."') + SUBTLE(' on its own line.\n'));
          output.write(ARROW);
          return;
        }
        promptLines.push(line);
        return;
      }
      if (phase === 'rubric') {
        if (line === '.') {
          if (!rubricLines.join('\n').trim()) {
            output.write(CROSS + SUBTLE('rubric cannot be empty — keep typing\n'));
            return;
          }
          output.write(
            TICK +
              SUBTLE(
                `rubric (${rubricLines.length} line${rubricLines.length === 1 ? '' : 's'})\n`,
              ),
          );
          resolved = true;
          rl.close();
          output.write('\n');
          output.write(chalk.green.bold('  ▶ running') + SUBTLE(' …\n'));
          output.write(RULE + '\n');
          resolve({ id: id!, prompt: promptLines.join('\n'), rubric: rubricLines.join('\n') });
          return;
        }
        rubricLines.push(line);
        return;
      }
    });

    rl.on('close', () => {
      if (!resolved) {
        reject(new Error('inline prompt input was aborted before completion'));
      }
    });
  });
}

function writeStep(output: NodeJS.WritableStream, n: number, name: string): void {
  output.write('\n');
  output.write(STEP(`  Step ${n}/3`) + SUBTLE(` · ${name}\n`));
}
