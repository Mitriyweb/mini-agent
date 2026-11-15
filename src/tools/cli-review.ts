import { runCliReview, type CliReviewerKind } from '../agent/cli-review.ts';
import { formatReviewMessage } from '../agent/review-provider.ts';
import { ReviewOrchestrator } from '../agent/review-orchestrator.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';

export interface CliReviewArgs {
  /** Optional focus area; appended to the review request. */
  focus?: string;
}

const REVIEW_INSTRUCTIONS = `You are an independent code reviewer. Review the change described in the bundle below and report actionable findings. For each finding include severity, file and line location when available, reasoning, and evidence. Distinguish confirmed defects from uncertainty, and state explicitly when evidence is incomplete or no findings were identified. Do not modify any files.`;

/**
 * Build the redacted review bundle sent to the external CLI. Reuses the
 * external-review pipeline so redaction patterns, size limits, and diff
 * truncation behave identically.
 */
export const buildCliReviewBundle = async (
  env: ToolEnvironment,
  kind: CliReviewerKind,
  focus?: string,
): Promise<string> => {
  const { workspace, reviewContext } = env;
  const orchestrator = new ReviewOrchestrator(workspace, { enabled: false });
  const baseline = reviewContext?.baseline ?? orchestrator.captureBaseline();
  const request = orchestrator.buildReviewRequest(
    reviewContext?.runId ?? 'cli-review',
    reviewContext?.task ?? 'Review the current workspace changes.',
    baseline,
  );

  const sections = [REVIEW_INSTRUCTIONS, '', `Reviewer: ${kind} CLI`, ''];
  if (focus?.trim()) {
    sections.push(`Focus area requested by the user: ${focus.trim()}`, '');
  }
  sections.push(formatReviewMessage(request));
  return sections.join('\n');
};

const createDefinition = (kind: CliReviewerKind, command: string): ToolDefinition => ({
  type: 'function',
  function: {
    name: `${kind}_review`,
    description: `Send a redacted review bundle of the current workspace changes to the ${command} CLI for an independent read-only review. Requires approval before anything is transmitted. Fails explicitly when the CLI is unavailable or the review cannot be completed; it never falls back to another reviewer.`,
    parameters: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description: 'Optional area to focus the review on (e.g. a file, module, or concern).',
        },
      },
    },
  },
});

export const createCliReviewTool = (
  env: ToolEnvironment,
  kind: CliReviewerKind,
): Tool<CliReviewArgs, string> => {
  const spec = kind === 'claude' ? { command: 'claude' } : { command: 'codex' };
  return {
    needsApproval: true,
    trust: TrustKind.ALWAYS,
    describe: () => `send redacted review bundle to ${spec.command} CLI`,
    execute: async (args) => {
      const bundle = await buildCliReviewBundle(env, kind, args?.focus);
      const result = await runCliReview({
        kind,
        bundle,
        signal: env.signal,
      });
      if (!result.ok) {
        return `ERROR: ${kind} review failed: ${result.error}`;
      }
      return result.output ?? '';
    },
    definition: createDefinition(kind, spec.command),
  };
};

export const createClaudeReviewTool = (env: ToolEnvironment): Tool<CliReviewArgs, string> =>
  createCliReviewTool(env, 'claude');

export const createCodexReviewTool = (env: ToolEnvironment): Tool<CliReviewArgs, string> =>
  createCliReviewTool(env, 'codex');
