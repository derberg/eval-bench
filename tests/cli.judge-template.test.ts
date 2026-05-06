import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execa } from 'execa';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// We capture the body of every judge call so the test can assert the
// custom template made it all the way through to the wire.
let server: Server;
let judgeUrl = '';
const judgeBodies: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      judgeBodies.push(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: '{"score":4,"rationale":"ok"}' } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (typeof addr === 'object' && addr) judgeUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function makeRepo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ef-judge-tmpl-'));
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 't@t'], { cwd: root });
  await execa('git', ['config', 'user.name', 't'], { cwd: root });
  writeFileSync(join(root, 'f'), '1');
  await execa('git', ['add', '.'], { cwd: root });
  await execa('git', ['commit', '-m', 'v1', '-q'], { cwd: root });
  await execa('git', ['tag', 'v1'], { cwd: root });
  writeFileSync(join(root, 'f'), '2');
  await execa('git', ['commit', '-am', 'v2', '-q'], { cwd: root });
  const fakeClaude = resolve('tests/fixtures/fake-claude.js');
  chmodSync(fakeClaude, 0o755);
  writeFileSync(
    join(root, 'eval-bench.yaml'),
    `plugin:\n  path: ./\nprovider:\n  command: node\n  extraArgs: ['${fakeClaude}']\n  timeout: 10\njudge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\nruns:\n  samples: 1\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`,
  );
  writeFileSync(join(root, 'prompts.yaml'), `- id: p1\n  prompt: hello\n  rubric: r\n`);
  return root;
}

const cliPath = resolve('src/cli/index.ts');
const sharedArgs = ['--config', 'eval-bench.yaml', '--prompts', 'prompts.yaml'];

const CUSTOM_TEMPLATE_BODY =
  'CUSTOM-MARKER-9F4A: This is a swapped wrapping prompt.\n' +
  'PROMPT={{prompt}}\nOUTPUT={{output}}\nRUBRIC={{rubric}}\n' +
  'Return {"score": N, "rationale": "..."}';

describe('--judge-template / judge.template', () => {
  beforeAll(() => {
    judgeBodies.length = 0;
  });

  it('--judge-template <path> overrides the default template — the custom marker shows up in the judge HTTP body', async () => {
    judgeBodies.length = 0;
    const repo = await makeRepo();
    const tmplPath = join(repo, 'judge.tmpl');
    writeFileSync(tmplPath, CUSTOM_TEMPLATE_BODY);

    const { exitCode } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'eval',
        '--save-as',
        's1',
        '--judge-template',
        tmplPath,
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    // The judge fixture above pushes every request body into judgeBodies.
    // Exactly one judge call (samples: 1, prompts: 1, eval = current only).
    expect(judgeBodies).toHaveLength(1);
    const sent = judgeBodies[0];
    expect(sent).toContain('CUSTOM-MARKER-9F4A');
    // Default wording must be absent — we really swapped the wrapper.
    expect(sent).not.toContain('impartial evaluator');
    // Placeholders must have been substituted, not sent verbatim.
    expect(sent).not.toContain('{{prompt}}');
    expect(sent).not.toContain('{{output}}');
    expect(sent).not.toContain('{{rubric}}');
  }, 60_000);

  it('judge.template in eval-bench.yaml works the same as --judge-template', async () => {
    judgeBodies.length = 0;
    const repo = await makeRepo();
    // Embed the template inline in the YAML using the | block scalar.
    writeFileSync(
      join(repo, 'eval-bench.yaml'),
      `plugin:\n  path: ./\nprovider:\n  command: node\n  extraArgs: ['${resolve('tests/fixtures/fake-claude.js')}']\n  timeout: 10\njudge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\n  template: |\n    YAML-MARKER-K7P: configured via eval-bench.yaml.\n    PROMPT={{prompt}}\n    OUTPUT={{output}}\n    RUBRIC={{rubric}}\n    Return {"score": N, "rationale": "..."}\nruns:\n  samples: 1\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`,
    );
    const { exitCode } = await execa(
      'npx',
      ['tsx', cliPath, 'eval', '--save-as', 's2', ...sharedArgs],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(judgeBodies).toHaveLength(1);
    expect(judgeBodies[0]).toContain('YAML-MARKER-K7P');
    expect(judgeBodies[0]).not.toContain('impartial evaluator');
  }, 60_000);

  it('--judge-template overrides judge.template in the config', async () => {
    judgeBodies.length = 0;
    const repo = await makeRepo();
    // Config has YAML-CONFIG marker; CLI flag points at a file with a CLI-FLAG marker.
    writeFileSync(
      join(repo, 'eval-bench.yaml'),
      `plugin:\n  path: ./\nprovider:\n  command: node\n  extraArgs: ['${resolve('tests/fixtures/fake-claude.js')}']\n  timeout: 10\njudge:\n  provider: ollama\n  model: q\n  endpoint: ${judgeUrl}\n  template: |\n    YAML-CONFIG marker.\n    PROMPT={{prompt}}\n    OUTPUT={{output}}\n    RUBRIC={{rubric}}\nruns:\n  samples: 1\n  parallel: 1\nsnapshots:\n  dir: ./snaps\n`,
    );
    const tmplPath = join(repo, 'cli.tmpl');
    writeFileSync(
      tmplPath,
      'CLI-FLAG marker.\nPROMPT={{prompt}}\nOUTPUT={{output}}\nRUBRIC={{rubric}}',
    );
    const { exitCode } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'eval',
        '--save-as',
        's3',
        '--judge-template',
        tmplPath,
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).toBe(0);
    expect(judgeBodies).toHaveLength(1);
    expect(judgeBodies[0]).toContain('CLI-FLAG marker');
    // The config's marker must NOT appear — CLI flag takes precedence.
    expect(judgeBodies[0]).not.toContain('YAML-CONFIG marker');
  }, 60_000);

  it('rejects a template missing required placeholders before any judge call', async () => {
    judgeBodies.length = 0;
    const repo = await makeRepo();
    const tmplPath = join(repo, 'broken.tmpl');
    // Missing {{output}} and {{rubric}}.
    writeFileSync(tmplPath, 'just {{prompt}} and nothing else');
    const { exitCode, stdout, stderr } = await execa(
      'npx',
      [
        'tsx',
        cliPath,
        'eval',
        '--save-as',
        's4',
        '--judge-template',
        tmplPath,
        ...sharedArgs,
      ],
      { cwd: repo, reject: false },
    );
    expect(exitCode).not.toBe(0);
    const all = stdout + stderr;
    expect(all).toMatch(/missing required placeholder/);
    expect(all).toMatch(/\{\{output\}\}/);
    expect(all).toMatch(/\{\{rubric\}\}/);
    // No judge call should have happened.
    expect(judgeBodies).toHaveLength(0);
  }, 30_000);
});
