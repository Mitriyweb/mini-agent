/**
 * Provider-neutral types for external review interface.
 *
 * The review interface is independent of the worker context and uses
 * the same provider abstractions as the agent for consistency.
 */

export enum ReviewVerdict {
  PASS = 'pass',
  FAIL = 'fail',
  HUMAN_REVIEW_NEEDED = 'human_review_needed',
}

export interface ReviewOutcome {
  verdict: ReviewVerdict;
  findings: string;
}

/**
 * Represents a single changed file (modified, new, or deleted).
 */

export enum FileChangeStatus {
  MODIFIED = 'modified',
  NEW = 'new',
  DELETED = 'deleted',
}

export enum ExecutionStatus {
  COMPLETED = 'completed',
  FAILED = 'failed',
  INTERRUPTED = 'interrupted',
}

export interface ChangedFile {
  path: string;
  status: FileChangeStatus;
  isBinary: boolean;
  sizeBytes?: number;
  unifiedDiff?: string; // Only present if not binary and passes redaction
}

/**
 * ReviewRequest captures all evidence needed for external review:
 * baseline state, changes, workspace context, and task description.
 *
 * Includes redacted diff (credentials excluded, size limited) and binary file listing only.
 */
export interface ReviewRequest {
  // Metadata
  runId: string;
  task: string;
  workspace: string;

  // Baseline snapshot (HEAD for Git, creation state for non-Git)
  baselineType: BaselineType;
  baselineRef?: string; // Git ref if applicable

  // Changes captured (all files: modified, new, deleted, untracked)
  changes: ChangedFile[];

  // Context for review
  executionReport?: {
    status: ExecutionStatus;
    stepsCompleted: number;
    toolsUsed: string[];
    messageCount: number;
    updatedAt: string;
  };

  // Metadata for data safety
  redactionApplied: boolean;
  redactionPatterns?: string[];
  diffTruncated: boolean;
  diffSizeBytes: number;
  diffMaxBytes: number;
  evidenceInconclusive?: boolean; // True if evidence could not be reliably collected
  truncationMetadata?: {
    filesOmitted: number;
    bytesOmitted: number;
  };
}

/**
 * ReviewResponse is the structured result returned by the external reviewer.
 *
 * Findings are free-form text (not a field list) to allow flexibility
 * in how reviewers express their analysis.
 */
export interface ReviewResponse {
  // Verdict on the execution
  verdict: ReviewVerdict;

  // Free-form findings text
  findings: string;

  // Metadata
  reviewedAt: string;
  providerModel?: string;
}

/**
 * Runtime representation of a completed review (persisted in RunState).
 */
export enum BaselineType {
  GIT_HEAD = 'git-head',
  CREATION_STATE = 'creation-state',
}

export enum ReviewResultStatus {
  SUCCESS = 'success',
  PROVIDER_FAILURE = 'provider_failure',
  MALFORMED_RESPONSE = 'malformed_response',
  INCOMPLETE_EVIDENCE = 'incomplete_evidence',
}

export interface ReviewResult {
  verdict: ReviewVerdict;
  findings: string;
  executedAt: string;
  baselineSnapshot?: {
    type: BaselineType;
    ref?: string;
  };
  metadata?: {
    providerModel?: string;
    retryCount?: number;
  };
  // Outcome status for error cases
  status?: ReviewResultStatus;
}
