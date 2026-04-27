import { execa } from 'execa';

export interface InvokeClaudeOptions {
  command: string;
  extraArgs: string[];
  prompt: string;
  pluginDir: string;
  timeoutMs: number;
  model: string | null;
  allowedTools: string[] | null;
}

export interface InvokeClaudeResult {
  output: string;
  exitCode: number;
  durationMs: number;
  error: string | null;
}

export async function invokeClaude(opts: InvokeClaudeOptions): Promise<InvokeClaudeResult> {
  const args = [...opts.extraArgs, '-p', opts.prompt];
  if (opts.model) {
    args.push('--model', opts.model);
  }
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowed-tools', opts.allowedTools.join(','));
  }
  const started = Date.now();
  try {
    const result = await execa(opts.command, args, {
      timeout: opts.timeoutMs,
      reject: false,
      env: {
        ...process.env,
        EVALFORGE_PLUGIN_DIR: opts.pluginDir,
      },
    });
    const durationMs = Date.now() - started;
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if (result.timedOut) {
      return { output, exitCode: result.exitCode ?? -1, durationMs, error: 'timed out' };
    }
    if (result.exitCode !== 0) {
      return {
        output,
        exitCode: result.exitCode ?? -1,
        durationMs,
        error: result.stderr || 'non-zero exit',
      };
    }
    return { output, exitCode: 0, durationMs, error: null };
  } catch (err) {
    const durationMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return { output: '', exitCode: -1, durationMs, error: msg };
  }
}
