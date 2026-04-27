import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function copyTemplate(templateName: string, targetPath: string): Promise<boolean> {
  if (await exists(targetPath)) return false;
  const contents = await readFile(join(TEMPLATES_DIR, templateName), 'utf8');
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, contents);
  return true;
}

export async function runInit(opts: { cwd: string; ci: boolean }): Promise<void> {
  const wrote: string[] = [];
  const skipped: string[] = [];
  if (await copyTemplate('evalforge.yaml', join(opts.cwd, '.evalforge', 'evalforge.yaml')))
    wrote.push('.evalforge/evalforge.yaml');
  else skipped.push('.evalforge/evalforge.yaml');
  if (await copyTemplate('prompts.yaml', join(opts.cwd, '.evalforge', 'prompts.yaml')))
    wrote.push('.evalforge/prompts.yaml');
  else skipped.push('.evalforge/prompts.yaml');
  const keep = join(opts.cwd, '.evalforge', 'snapshots', '.gitkeep');
  if (!(await exists(keep))) {
    await mkdir(dirname(keep), { recursive: true });
    await writeFile(keep, '');
    wrote.push('.evalforge/snapshots/.gitkeep');
  }
  if (opts.ci) {
    const ciTarget = join(opts.cwd, '.github', 'workflows', 'evalforge.yml');
    if (await copyTemplate('github-action.yml', ciTarget))
      wrote.push('.github/workflows/evalforge.yml');
    else skipped.push('.github/workflows/evalforge.yml');
  }
  for (const f of wrote) console.log(`  created  ${f}`);
  for (const f of skipped) console.log(`  skipped  ${f} (already exists)`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Edit .evalforge/prompts.yaml — write 3-5 prompts that exercise your plugin');
  console.log('  2. Edit .evalforge/evalforge.yaml — set judge provider and model');
  console.log('  3. Run: eb run --baseline <ref> --save-as v1-baseline');
}
