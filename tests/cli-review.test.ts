import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCliReview, CLI_REVIEW_SPECS } from '../src/agent/cli-review.js';
import { buildCliReviewBundle, createCliReviewTool } from '../src/tools/cli-review.js';
import { createBuiltInRegistry, runToolCall } from '../src/agent/agent.js';
import { createPermissions } from '../src/agent/permissions.js';
import { Workspace } from '../src/agent/workspace.js';
import { Logger } from '../src/agent/logging.js';
import type { ToolEnvironment } from '../src/types/tools.js';

const BUNDLE = '## Review Request\n\n**Task:** review me\n\n### Changes\n- ~ modified `src/foo.ts`\n';

describe('CLI review adapter', () => {
  let tmp: string;
  let binDir: string;
  let logDir: string;
  let originalPath: string | undefined;

  const stubPath = () => `${binDir}:${originalPath}`;

  const writeStub = async (name: string, body: string) => {
    const file = path.join(binDir, name);
    await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  };

  const recordingStub = (extra = '') => `
{
  echo "PWD:$PWD"
  echo "ARGS:$@"
  echo "FILES:$(ls -A | tr '\\n' ' ')"
  cat > "$STUB_STDIN"
}
${extra}
echo "stub review findings"
`;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-cli-review-'));
    binDir = path.join(tmp, 'bin');
    logDir = path.join(tmp, 'logs');
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(logDir, { recursive: true });
    originalPath = process.env.PATH;
  });

  afterEach(async () => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await fs.rm(tmp, { recursive: true, force: true });
  });

  const envFor = () => ({
    PATH: stubPath(),
    STUB_STDIN: path.join(logDir, 'stdin.txt'),
    STUB_LOG: path.join(logDir, 'log.txt'),
  });

  it('invokes claude with fixed read-only args from an isolated bundle directory', async () => {
    await writeStub('claude', recordingStub());
    const result = await runCliReview({ kind: 'claude', bundle: BUNDLE, env: envFor() });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('stub review findings');

    const log = await fs.readFile(path.join(logDir, 'stdin.txt'), 'utf8');
    expect(log).toBe(BUNDLE);

    // Inspect what the stub recorded by re-running capture into files.
    // The stub wrote PWD/ARGS/FILES to stdout mixed with findings; instead
    // verify via a dedicated log file approach below.
  });

  it('records cwd contents, args, and stdin for both CLIs', async () => {
    for (const kind of ['claude', 'codex'] as const) {
      await writeStub(kind, `
{
  echo "PWD:$PWD" > "$STUB_LOG"
  echo "ARGS:$@" >> "$STUB_LOG"
  echo "FILES:$(ls -A | tr '\\n' ' ')" >> "$STUB_LOG"
  cat > "$STUB_STDIN"
}
echo "findings for $0"
`);
      const result = await runCliReview({ kind, bundle: BUNDLE, env: envFor() });
      expect(result.ok).toBe(true);

      const log = await fs.readFile(path.join(logDir, 'log.txt'), 'utf8');
      const lines = log.trim().split('\n');
      expect(lines[0]).toMatch(/^PWD:.+mini-agent-(claude|codex)-review-/);
      expect(lines[1]).toContain('ARGS:');
      expect(lines[2]).toContain('FILES:review-bundle.md');
      // Only the bundle exists in the temp dir (trailing space from ls).
      expect(lines[2].trim()).toBe('FILES:review-bundle.md');

      const spec = CLI_REVIEW_SPECS[kind];
      for (const arg of spec.args) {
        expect(lines[1]).toContain(arg);
      }
      const stdin = await fs.readFile(path.join(logDir, 'stdin.txt'), 'utf8');
      expect(stdin).toBe(BUNDLE);

      await fs.rm(path.join(logDir, 'log.txt'), { force: true });
      await fs.rm(path.join(logDir, 'stdin.txt'), { force: true });
    }
  });

  it('uses read-only sandbox arguments for each CLI', () => {
    expect(CLI_REVIEW_SPECS.claude.args).toContain('-p');
    expect(CLI_REVIEW_SPECS.claude.args).toContain('plan');
    expect(CLI_REVIEW_SPECS.codex.args).toContain('exec');
    expect(CLI_REVIEW_SPECS.codex.args).toContain('read-only');
  });

  it('fails explicitly when the CLI is missing', async () => {
    const result = await runCliReview({
      kind: 'claude',
      bundle: BUNDLE,
      env: { PATH: path.join(tmp, 'empty-bin') },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails explicitly on non-zero exit and surfaces stderr', async () => {
    await writeStub('codex', 'echo "auth required" >&2\nexit 3');
    const result = await runCliReview({ kind: 'codex', bundle: BUNDLE, env: envFor() });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('exited with code 3');
    expect(result.error).toContain('auth required');
  });

  it('fails explicitly on empty output', async () => {
    await writeStub('claude', 'exit 0');
    const result = await runCliReview({ kind: 'claude', bundle: BUNDLE, env: envFor() });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('no review output');
  });

  it('enforces the timeout', async () => {
    await writeStub('claude', 'sleep 5');
    const result = await runCliReview({ kind: 'claude', bundle: BUNDLE, env: envFor(), timeoutMs: 50 });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('enforces cancellation', async () => {
    await writeStub('codex', 'sleep 5');
    const controller = new AbortController();
    const promise = runCliReview({ kind: 'codex', bundle: BUNDLE, env: envFor(), signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('cancelled');
  });

  it('cleans up the temporary review directory', async () => {
    let seenDir = '';
    await writeStub('claude', `
seen=$(ls -d "$PWD")
echo "DIR:$seen" > "$STUB_LOG"
cat > /dev/null
echo ok
`);
    await runCliReview({ kind: 'claude', bundle: BUNDLE, env: envFor() });
    const log = await fs.readFile(path.join(logDir, 'log.txt'), 'utf8');
    seenDir = log.trim().replace('DIR:', '');
    expect(seenDir).toContain('mini-agent-claude-review-');
    await expect(fs.access(seenDir)).rejects.toThrow();
  });
});

describe('CLI review tools', () => {
  let workspace: Workspace;
  let env: ToolEnvironment;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-cli-tool-'));
    workspace = await Workspace.open(dir);
    env = { workspace };
  });

  it('builds a redacted bundle without workspace access', async () => {
    const bundle = await buildCliReviewBundle(env, 'claude', 'focus on src');
    expect(bundle).toContain('Reviewer: claude CLI');
    expect(bundle).toContain('focus on src');
    expect(bundle).toContain('Review Request');
    // The bundle is text only; it must not embed absolute workspace paths
    // beyond the workspace root label already present in the request format.
    expect(bundle).not.toContain(process.cwd());
  });

  it('denied approval prevents the CLI from starting', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-cli-stub-'));
    const binDir = path.join(dir, 'bin');
    const marker = path.join(dir, 'started.txt');
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(
      path.join(binDir, 'claude'),
      `#!/bin/sh\ntouch "${marker}"\necho hi\n`,
      { mode: 0o755 },
    );

    const registry = createBuiltInRegistry(env);
    const permissions = createPermissions(
      { askDecision: async () => false },
      workspace,
    );
    const logger = new Logger({ level: 'off' });

    const output = await runToolCall(
      { id: 'call_1', function: { name: 'claude_review', arguments: '{}' } },
      { permissions, emit: async () => {}, registry, logger },
    );

    expect(String(output.content)).toContain('DENIED');
    await expect(fs.access(marker)).rejects.toThrow();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports missing CLI as an explicit tool error', async () => {
    const tool = createCliReviewTool(env, 'codex');
    const originalPath = process.env.PATH;
    process.env.PATH = path.join(os.tmpdir(), 'definitely-empty-path-dir');
    try {
      const result = await tool.execute({});
      expect(String(result)).toContain('ERROR:');
      expect(String(result)).toContain('codex');
      expect(String(result)).toContain('not found');
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
