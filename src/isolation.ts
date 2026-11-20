import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// The provider settings that decide what loads into a run session, read from
// a snapshot's saved config. Snapshots from before 0.28 have no isolation
// fields: they loaded the setting sources their extraArgs named (all of them
// by default) and the claude.ai connectors.
export interface IsolationSettings {
  extraArgs?: string[];
  isolation?: boolean;
  claudeAiConnectors?: boolean;
  extraPlugins?: string[];
}

// The value of --setting-sources in args, in either form, or null.
export function settingSourcesArg(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--setting-sources') return args[i + 1] ?? '';
    if (args[i].startsWith('--setting-sources=')) return args[i].slice('--setting-sources='.length);
  }
  return null;
}

// Describes what reached the command line, the way src/provider.ts builds it.
function describe(s: IsolationSettings): string {
  const isolation = s.isolation ?? false;
  const sources = settingSourcesArg(s.extraArgs ?? []) ?? (isolation ? 'project' : null);
  const connectorsOff = isolation && !(s.claudeAiConnectors ?? false);
  const extras = (s.extraPlugins ?? []).map((p) => resolve(p)).sort();
  return [
    sources === null ? 'all setting sources' : `setting sources: ${sources || 'none'}`,
    connectorsOff ? 'claude.ai connectors off' : 'claude.ai connectors on',
    extras.length > 0 ? `extra plugins: ${extras.join(', ')}` : 'no extra plugins',
  ].join(', ');
}

// Resolves extra plugin paths against the eb process cwd, so a snapshot
// records full paths, and warns about a folder that does not exist: claude
// would start without that plugin.
export function resolveExtraPlugins(paths: string[], warn: (msg: string) => void): string[] {
  return paths.map((p) => {
    const abs = resolve(p);
    if (!existsSync(abs)) warn(`Extra plugin folder not found: ${abs}`);
    return abs;
  });
}

// One line for the run header: what loads next to the built-in tools.
export function describeLoadedPlugins(cfg: { provider: IsolationSettings }): string {
  const p = cfg.provider;
  const base = p.isolation ? 'only the plugin under test' : 'everything installed (isolation off)';
  const extras = p.extraPlugins ?? [];
  return extras.length > 0 ? `${base} + ${extras.join(', ')}` : base;
}

// Returns a sentence naming the difference when the runs reused from a
// snapshot loaded a different environment than this run, or null.
export function isolationMismatch(
  reused: IsolationSettings,
  current: IsolationSettings,
): string | null {
  const a = describe(reused);
  const b = describe(current);
  return a === b ? null : `recorded with ${a}; this run uses ${b}`;
}
