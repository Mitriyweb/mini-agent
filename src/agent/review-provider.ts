/**
 * Review provider: executes external review using the provider abstractions.
 *
 * The reviewer is instantiated in a separate context (not the worker's context)
 * using the same LLM infrastructure but with a dedicated system prompt.
 *
 * NOTE: Retry is handled by the provider itself using existing retry policy.
 * No additional retry loop is added here to avoid double-retry.
 * Abort signal is properly respected during any delays.
 */

import type { Provider } from './providers/types.ts';
import type { ReviewRequest, ReviewResponse } from './review-types.ts';

const REVIEW_SYSTEM_PROMPT = `You are an independent code reviewer. Your role is to evaluate the execution evidence provided and return a structured review verdict.

For each review, you will receive:
- The original task
- Baseline state (pre-execution workspace snapshot)
- All files changed (with diff content, redacted for credentials)
- Execution metadata (steps completed, tools used, status)

Your response MUST be JSON with this structure:
{
  "verdict": "pass" | "fail" | "human_review_needed",
  "findings": "Free-form findings text..."
}

Verdicts:
- "pass": The execution appears sound and complete.
- "fail": The execution has problems that should be fixed.
- "human_review_needed": The execution needs human review before proceeding.

Keep findings concise but substantive. If there are suggested fixes, include them in findings.`;

export class MalformedReviewResponseError extends Error {
  constructor() {
    super('Review provider returned malformed response (expected JSON structure)');
    this.name = 'MalformedReviewResponseError';
  }
}

/**
 * Execute external review using a separate provider context.
 *
 * Retry policy is handled by the provider itself (existing classifyLLMError + backoff).
 * No additional retry loop is added here to avoid double-retry.
 * Abort signal is properly respected.
 */
export async function executeReview(
  provider: Provider,
  reviewRequest: ReviewRequest,
  signal?: AbortSignal,
): Promise<ReviewResponse> {
  if (signal?.aborted) {
    throw new Error('Review execution aborted');
  }

  // Format ReviewRequest as a user message for the reviewer
  const userMessage = formatReviewMessage(reviewRequest);

  const response = await provider.respond({
    messages: [
      { role: 'system', content: REVIEW_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    signal,
  });

  const message = response.choices?.[0]?.message;
  if (!message) throw new Error('Review provider returned no message');

  const content = typeof message.content === 'string' ? message.content : '';

  // Parse JSON response
  const parsed = parseReviewResponse(content);
  if (!parsed) {
    throw new MalformedReviewResponseError();
  }

  return {
    ...parsed,
    reviewedAt: new Date().toISOString(),
    providerModel: provider.model,
  };
}

/**
 * Format ReviewRequest into a human-readable message for the reviewer.
 */
function formatReviewMessage(req: ReviewRequest): string {
  const lines: string[] = [];

  lines.push('## Review Request');
  lines.push('');
  lines.push(`**Task:** ${req.task}`);
  lines.push(`**Run ID:** ${req.runId}`);
  lines.push(`**Workspace:** ${req.workspace}`);
  lines.push('');

  // Baseline
  lines.push('### Baseline');
  lines.push(`- **Type:** ${req.baselineType}`);
  if (req.baselineRef) {
    lines.push(`- **Ref:** ${req.baselineRef}`);
  }
  lines.push('');

  // Evidence quality warning
  if (req.evidenceInconclusive) {
    lines.push('⚠️ **Note:** Evidence collection was inconclusive (non-Git workspace or collection error). Review may be incomplete.');
    lines.push('');
  }

  // Execution metadata
  if (req.executionReport) {
    lines.push('### Execution');
    lines.push(`- **Status:** ${req.executionReport.status}`);
    lines.push(`- **Steps:** ${req.executionReport.stepsCompleted}`);
    lines.push(`- **Tools:** ${req.executionReport.toolsUsed.join(', ') || 'none'}`);
    lines.push(`- **Messages:** ${req.executionReport.messageCount}`);
    lines.push('');
  }

  // Changes
  lines.push('### Changes');
  if (req.changes.length === 0) {
    lines.push('- No files changed.');
  } else {
    for (const change of req.changes) {
      const status = change.status === 'new' ? '✓ new' : change.status === 'deleted' ? '✗ deleted' : '~ modified';
      const binary = change.isBinary ? ' (binary)' : '';
      const size = change.sizeBytes ? ` ${change.sizeBytes} bytes` : '';
      lines.push(`- ${status} \`${change.path}\`${binary}${size}`);

      if (change.unifiedDiff) {
        lines.push('  ```');
        lines.push(change.unifiedDiff);
        lines.push('  ```');
      }
    }
  }
  lines.push('');

  // Data safety metadata
  if (req.redactionApplied) {
    lines.push('### Data Safety');
    lines.push('- Redaction applied to exclude credentials and sensitive files');
    if (req.diffTruncated) {
      lines.push(`- ⚠️ **Diff truncated** (exceeded ${req.diffMaxBytes / 1024} KB limit)`);
      if (req.truncationMetadata) {
        lines.push(`  - Files omitted: ${req.truncationMetadata.filesOmitted}`);
        lines.push(`  - Bytes omitted: ${req.truncationMetadata.bytesOmitted}`);
      }
    }
    lines.push('');
  } else if (req.diffTruncated) {
    lines.push('### Data Safety');
    lines.push(`- ⚠️ **Diff truncated** (exceeded ${req.diffMaxBytes / 1024} KB limit)`);
    if (req.truncationMetadata) {
      lines.push(`  - Files omitted: ${req.truncationMetadata.filesOmitted}`);
      lines.push(`  - Bytes omitted: ${req.truncationMetadata.bytesOmitted}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Parse ReviewResponse from reviewer's JSON output.
 */
function parseReviewResponse(content: string): Omit<ReviewResponse, 'reviewedAt' | 'providerModel'> | null {
  try {
    // Try to extract JSON from content (reviewer might wrap it in text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.verdict === 'string' &&
      typeof parsed.findings === 'string' &&
      ['pass', 'fail', 'human_review_needed'].includes(parsed.verdict)
    ) {
      return { verdict: parsed.verdict, findings: parsed.findings };
    }

    return null;
  } catch {
    return null;
  }
}
