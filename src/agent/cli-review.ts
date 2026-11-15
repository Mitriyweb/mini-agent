import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Constrained adapter for external CLI reviewers (Claude Code, Codex CLI).
 *
 * The adapter never assembles a shell command: the CLI is invoked through an
 * argument array with fixed non-interactive, read-only flags, its working
 * directory is an isolated temporary directory containing only the redacted
 * review bundle, and the bundle is delivered over stdin. Approval, timeout,
 * and cancellation are enforced by the caller/tool layer; this module fails
 * closed with explicit errors when the CLI is missing, exits unsuccessfully,
 * times out, or returns unusable output.
 */

export type CliReviewerKind = 'claude' | 'codex';

export interface CliReviewSpec {
  /** Executable name resolved through PATH (never a shell). */
  command: string;
  /** Fixed non-interactive read-only arguments. */
  args: string[];
}

export const CLI_REVIEW_SPECS: Record<CliReviewerKind, CliReviewSpec> = {
  claude: {
    command: 'claude',
    // -p: non-interactive print mode (prompt read from stdin).
    // --output-format text: plain-text findings on stdout.
    // --permission-mode plan: read-only planning mode; any tool call that
    // would prompt is denied because nothing can answer interactively.
    args: ['-p', '--output-format', 'text', '--permission-mode', 'plan'],
  },
  codex: {
    command: 'codex',
    // exec: non-interactive mode. --sandbox read-only: model-generated
    // commands cannot write. --skip-git-repo-check: the temp dir is not a
    // git repo. --ephemeral: no session persistence.
    args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral'],
  },
};

export const DEFAULT_CLI_REVIEW_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 200_000;

export interface CliReviewOptions {
  kind: CliReviewerKind;
  /** Redacted review bundle delivered to the CLI over stdin. */
  bundle: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra environment for the child process (merged over process.env). */
  env?: NodeJS.ProcessEnv;
  /** Test hook: replace process spawning. */
  spawnImpl?: typeof spawn;
}

export interface CliReviewResult {
  ok: boolean;
  output?: string;
  error?: string;
  durationMs?: number;
}

interface SpawnedResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

const spawnAndCollect = (
  spec: CliReviewSpec,
  cwd: string,
  bundle: string,
  options: CliReviewOptions,
): Promise<SpawnedResult> => {
  const spawnFn = options.spawnImpl ?? spawn;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnFn(spec.command, spec.args, {
        cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolve({ code: null, signal: null, stdout: '', stderr: '', spawnError: error as Error });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: SpawnedResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const kill = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        // process already gone
      }
    };

    const timer = setTimeout(() => {
      kill();
      finish({ code: null, signal: 'SIGKILL', stdout, stderr: `${stderr}\n[mini-agent] review timed out after ${options.timeoutMs ?? DEFAULT_CLI_REVIEW_TIMEOUT_MS}ms` });
    }, options.timeoutMs ?? DEFAULT_CLI_REVIEW_TIMEOUT_MS);
    timer.unref?.();

    const onAbort = () => {
      kill();
      finish({ code: null, signal: 'SIGKILL', stdout, stderr: `${stderr}\n[mini-agent] review cancelled` });
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      finish({ code: null, signal: null, stdout, stderr, spawnError: error });
    });
    child.on('close', (code, signal) => {
      finish({ code, signal, stdout, stderr });
    });

    child.stdin?.on('error', () => {
      // EPIPE when the CLI exits before consuming stdin; close() reports the real result.
    });
    child.stdin?.end(bundle, 'utf8');
  });
};

/**
 * Run a single CLI reviewer against a redacted review bundle.
 *
 * Returns an explicit result for every failure mode; never throws for CLI
 * problems and never substitutes another reviewer.
 */
export const runCliReview = async (options: CliReviewOptions): Promise<CliReviewResult> => {
  const spec = CLI_REVIEW_SPECS[options.kind];
  const startedAt = Date.now();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mini-agent-${options.kind}-review-`));
  try {
    // The temporary directory contains only the redacted review bundle.
    await fs.writeFile(path.join(dir, 'review-bundle.md'), options.bundle, 'utf8');

    const result = await spawnAndCollect(spec, dir, options.bundle, options);
    const durationMs = Date.now() - startedAt;

    if (result.spawnError) {
      const code = (result.spawnError as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return {
          ok: false,
          durationMs,
          error: `${spec.command} CLI was not found on PATH. Install and authenticate the ${options.kind} CLI, then retry.`,
        };
      }
      return { ok: false, durationMs, error: `Failed to start ${spec.command} CLI: ${result.spawnError.message}` };
    }

    if (options.signal?.aborted) {
      return { ok: false, durationMs, error: `${options.kind} review was cancelled.` };
    }

    const stderrTail = result.stderr.trim().slice(-2000);
    if (result.code !== 0) {
      const reason = result.signal ? `terminated by ${result.signal}` : `exited with code ${result.code}`;
      return {
        ok: false,
        durationMs,
        error: `${spec.command} CLI ${reason}.${stderrTail ? `\n${stderrTail}` : ''}`,
      };
    }

    const output = result.stdout.trim();
    if (!output) {
      return { ok: false, durationMs, error: `${spec.command} CLI returned no review output.` };
    }

    return { ok: true, output, durationMs };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};
