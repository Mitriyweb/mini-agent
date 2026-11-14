/**
 * Orchestrator for external review: builds ReviewRequest, executes review,
 * handles outcomes, and persists results in RunState.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ReviewRequest, ReviewResponse, ReviewResult } from './review-types.ts';
import { FileChangeStatus, BaselineType, ReviewResultStatus, ExecutionStatus } from './review-types.ts';
import { Workspace } from './workspace.ts';
import { redactSecrets } from './logging.ts';

/**
 * Configuration for external review feature.
 */
export interface ReviewConfig {
  enabled: boolean;
  authorizedProvider?: string;
  retries?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffFactor?: number;
  };
}

/**
 * Utilities for building review requests and redacting sensitive data.
 */
export class ReviewOrchestrator {
  private workspace: Workspace;
  private config: ReviewConfig;

  constructor(workspace: Workspace, config: ReviewConfig = { enabled: false }) {
    this.workspace = workspace;
    this.config = config;
  }

  /**
   * Check if review is enabled and authorized.
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.authorizedProvider;
  }

  /**
   * Validate that authorized provider is valid and either distinct from or equal to the worker provider.
   * The review context may intentionally reuse the worker provider when configured explicitly.
   */
  validateAuthorization(workerProviderId: string, providerRegistry?: { has(id: string): boolean }): void {
    if (!this.config.authorizedProvider) {
      throw new Error('Review is not authorized: authorizedProvider must be configured');
    }
    const providerId = this.config.authorizedProvider.trim();
    if (providerRegistry && !providerRegistry.has(providerId)) {
      throw new Error(`Review authorized provider '${providerId}' is not configured in the provider registry.`);
    }
    if (providerId.toLowerCase() === workerProviderId.toLowerCase()) {
      return;
    }
  }

  private validateGitRef(ref: string): string {
    const trimmed = ref.trim();
    if (!trimmed || !/^[A-Za-z0-9][A-Za-z0-9._/:-]*$/.test(trimmed)) {
      throw new Error(`Unsafe git ref: ${trimmed}`);
    }
    return trimmed;
  }

  private resolveContainedPath(filePath: string): string | null {
    const normalizedPath = filePath.replace(/^['"]|['"]$/g, '').trim();
    if (!normalizedPath || normalizedPath.includes('\0')) {
      return null;
    }

    const workspaceRoot = path.resolve(this.workspace.root);
    const absolutePath = path.resolve(workspaceRoot, normalizedPath);
    const relative = path.relative(workspaceRoot, absolutePath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return null;
    }

    if (fs.existsSync(absolutePath)) {
      const realPath = fs.realpathSync(absolutePath);
      const realRelative = path.relative(this.workspace.realRoot, realPath);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        return null;
      }
    }

    return absolutePath;
  }

  private normalizeBaseline(baseline?: { type?: BaselineType; baselineType?: BaselineType; ref?: string; timestamp?: string }): { type: BaselineType; ref?: string; timestamp: string } {
    if (!baseline) {
      return { type: BaselineType.CREATION_STATE, timestamp: new Date().toISOString() };
    }
    const type = baseline.type ?? baseline.baselineType ?? BaselineType.CREATION_STATE;
    return {
      type,
      ref: baseline.ref,
      timestamp: baseline.timestamp ?? new Date().toISOString(),
    };
  }

  /**
   * Capture baseline state (Git HEAD or creation state) BEFORE execution.
   * Returns baseline metadata that can be used later to compute diffs.
   */
  captureBaseline(): { type: BaselineType; ref?: string; timestamp: string } {
    const timestamp = new Date().toISOString();
    try {
      const gitRoot = this.workspace.gitRoot;
      if (gitRoot) {
        const ref = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: gitRoot,
          encoding: 'utf8',
        }).trim();
        return { type: BaselineType.GIT_HEAD, ref, timestamp };
      }
    } catch {
      // Not in Git; continue with creation-state
    }
    return { type: BaselineType.CREATION_STATE, timestamp };
  }

  /**
   * Compute actual diff between baseline and current state.
   * Includes staged, committed, renamed, deleted, and untracked changes.
   */
  private computeDiffFromBaseline(baseline: { type: BaselineType; ref?: string }): {
    changes: ReviewRequest['changes'];
    inconclusive: boolean;
  } {
    const changes: ReviewRequest['changes'] = [];
    let inconclusive = false;

    try {
      const gitRoot = this.workspace.gitRoot;
      if (!gitRoot) {
        inconclusive = true;
        return { changes, inconclusive };
      }

      if (baseline.type !== BaselineType.GIT_HEAD || !baseline.ref) {
        inconclusive = true;
        return { changes, inconclusive };
      }

      const safeRef = this.validateGitRef(baseline.ref);
      const diffOutputs = [
        execFileSync('git', ['diff', '--name-status', '--find-renames', safeRef, 'HEAD'], { cwd: gitRoot, encoding: 'utf8' }),
        execFileSync('git', ['diff', '--name-status', '--find-renames', safeRef], { cwd: gitRoot, encoding: 'utf8' }),
        execFileSync('git', ['diff', '--cached', '--name-status', '--find-renames'], { cwd: gitRoot, encoding: 'utf8' }),
        execFileSync('git', ['diff', '--name-status', '--find-renames'], { cwd: gitRoot, encoding: 'utf8' }),
      ];

      const seen = new Map<string, ReviewRequest['changes'][number]>();
      const recordChange = (filePath: string, rawStatus: string) => {
        if (!filePath) return;

        const normalizedPath = filePath.replace(/^['"]|['"]$/g, '').trim();
        const containedPath = this.resolveContainedPath(normalizedPath);
        if (!containedPath) {
          inconclusive = true;
          return;
        }

        const existing = seen.get(normalizedPath);
        const statusCode = rawStatus.toUpperCase();

        let fileStatus: FileChangeStatus = FileChangeStatus.MODIFIED;
        if (statusCode.startsWith('A') || statusCode.startsWith('C')) fileStatus = FileChangeStatus.NEW;
        if (statusCode.startsWith('D')) fileStatus = FileChangeStatus.DELETED;
        if (statusCode.startsWith('R')) fileStatus = FileChangeStatus.MODIFIED;

        const isBinary = this.isBinaryFile(containedPath);
        const sizeBytes = fs.existsSync(containedPath) ? fs.statSync(containedPath).size : undefined;

        const nextRecord = {
          path: normalizedPath,
          status: fileStatus,
          isBinary,
          sizeBytes,
        };

        if (!existing || (existing.status === FileChangeStatus.DELETED && fileStatus !== FileChangeStatus.DELETED)) {
          seen.set(normalizedPath, nextRecord);
        }
      };

      for (const diffOutput of diffOutputs) {
        const lines = diffOutput.split('\n').filter((line) => line.trim());
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length < 2) continue;
          const statusCode = parts[0];
          const filePath = statusCode.startsWith('R') || statusCode.startsWith('C') ? parts[parts.length - 1] : parts[1];
          recordChange(filePath, statusCode);
        }
      }

      const statusOutput = execFileSync('git', ['status', '--porcelain'], { cwd: gitRoot, encoding: 'utf8' });
      for (const line of statusOutput.split('\n').filter((value) => value.trim())) {
        if (!line.startsWith('??')) continue;
        const filePath = line.substring(3).trim();
        const containedPath = this.resolveContainedPath(filePath);
        if (!containedPath) {
          inconclusive = true;
          continue;
        }
        if (seen.has(filePath)) continue;
        seen.set(filePath, {
          path: filePath,
          status: FileChangeStatus.NEW,
          isBinary: this.isBinaryFile(containedPath),
          sizeBytes: fs.existsSync(containedPath) ? fs.statSync(containedPath).size : undefined,
        });
      }

      for (const change of seen.values()) {
        changes.push(change);
      }

      return { changes, inconclusive: false };
    } catch {
      inconclusive = true;
      return { changes, inconclusive };
    }
  }

  /**
   * Load redaction patterns from .redactignore in workspace.
   */
  private loadRedactionPatterns(): string[] {
    const redactignorePath = path.join(this.workspace.root, '.redactignore');
    const patterns: string[] = [
      // Default patterns
      '.env',
      '.env.*',
      '*.key',
      '*.pem',
      'secrets/',
      'credentials/',
      '.credentials',
      'node_modules/',
      '.git/',
    ];

    if (fs.existsSync(redactignorePath)) {
      try {
        const content = fs.readFileSync(redactignorePath, 'utf8');
        const customPatterns = content
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith('#'));
        patterns.push(...customPatterns);
      } catch {
        // Silently ignore .redactignore read errors
      }
    }

    return patterns;
  }

  /**
   * Check if a path should be redacted based on patterns.
   */
  private shouldRedact(filePath: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (!pattern) continue;
      const normalizedPattern = pattern.trim();
      if (!normalizedPattern) continue;

      const escaped = normalizedPattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*');

      if (normalizedPattern.endsWith('/')) {
        if (filePath.includes(normalizedPattern.replace(/\/$/, ''))) return true;
      }
      if (new RegExp(`^${escaped}$`, 'i').test(filePath) || new RegExp(`(^|/)${escaped}$`, 'i').test(filePath)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Apply content-level redaction to text: mask common secret patterns.
   * Reuses shared redactSecrets helper from logging module.
   */
  private redactSecrets(content: string): string {
    return redactSecrets(content) as string;
  }

  /**
   * Build a unified diff for changed files, applying redaction.
   * Returns null for redacted or binary files.
   * Returns diff content and whether it was truncated.
   */
  private buildFileDiff(
    filePath: string,
    status: FileChangeStatus,
    baseline: { type: BaselineType; ref?: string },
    redactionPatterns: string[],
  ): { diff: string; truncated: boolean; redacted: boolean } | null {
    if (this.shouldRedact(filePath, redactionPatterns)) return null;

    try {
      const gitRoot = this.workspace.gitRoot;
      if (!gitRoot) return null;

      const containedPath = this.resolveContainedPath(filePath);
      if (!containedPath) return null;
      const relativePath = path.relative(gitRoot, containedPath).replace(/\\/g, '/');
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return null;
      }

      let diffContent = '';

      if (baseline.type === BaselineType.GIT_HEAD && baseline.ref) {
        if (status === FileChangeStatus.DELETED) {
          try {
            diffContent = execFileSync('git', ['diff', this.validateGitRef(baseline.ref), '--', relativePath], {
              cwd: gitRoot,
              encoding: 'utf8',
              maxBuffer: 10 * 1024 * 1024,
            });
          } catch {
            return null;
          }
        } else if (status === FileChangeStatus.NEW) {
          if (fs.existsSync(containedPath)) {
            let content = fs.readFileSync(containedPath, 'utf8');
            const redactedContent = this.redactSecrets(content);
            const lines = redactedContent.split('\n');
            diffContent = `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
          }
        } else {
          try {
            diffContent = execFileSync('git', ['diff', this.validateGitRef(baseline.ref), '--', relativePath], {
              cwd: gitRoot,
              encoding: 'utf8',
              maxBuffer: 10 * 1024 * 1024,
            });
          } catch {
            return null;
          }
        }
      } else {
        if (status === FileChangeStatus.NEW) {
          if (fs.existsSync(containedPath)) {
            let content = fs.readFileSync(containedPath, 'utf8');
            const redactedContent = this.redactSecrets(content);
            const lines = redactedContent.split('\n');
            diffContent = `--- /dev/null\n+++ b/${relativePath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join('\n')}`;
          }
        } else {
          return null;
        }
      }

      if (!diffContent) return null;

      const originalDiff = diffContent;
      const redactedDiff = this.redactSecrets(diffContent);
      const redacted = redactedDiff !== originalDiff;
      diffContent = redactedDiff;

      const maxPerFile = 100 * 1024;
      if (diffContent.length > maxPerFile) {
        const truncated = diffContent.slice(0, maxPerFile);
        return {
          diff: `${truncated}\n\n... [diff truncated: ${diffContent.length - maxPerFile} bytes omitted]`,
          truncated: true,
          redacted,
        };
      }

      return { diff: diffContent, truncated: false, redacted };
    } catch {
      return null;
    }
  }


  /**
   * Heuristic check for binary files.
   */
  private isBinaryFile(filePath: string): boolean {
    const binaryExtensions = [
      '.bin',
      '.jpg',
      '.png',
      '.gif',
      '.zip',
      '.tar',
      '.gz',
      '.o',
      '.exe',
      '.dll',
      '.so',
    ];
    const ext = path.extname(filePath).toLowerCase();
    return binaryExtensions.includes(ext);
  }

  /**
   * Build a ReviewRequest with redaction and size limits applied.
   * Baseline must have been captured BEFORE execution.
   */
  buildReviewRequest(
    runId: string,
    task: string,
    baseline?: { type?: BaselineType; baselineType?: BaselineType; ref?: string; timestamp?: string } | { status: string; stepsCompleted: number; toolsUsed: string[]; messageCount: number; updatedAt: string },
    executionMetadata?: {
      status: ExecutionStatus;
      stepsCompleted: number;
      toolsUsed: string[];
      messageCount: number;
      updatedAt: string;
    },
  ): ReviewRequest {
    const normalizedBaseline = this.normalizeBaseline(baseline as any);
    const redactionPatterns = this.loadRedactionPatterns();
    const { changes, inconclusive } = this.computeDiffFromBaseline(normalizedBaseline);

    const diffMaxBytes = 500 * 1024;
    let diffSizeBytes = 0;
    let diffTruncated = false;
    let filesOmitted = 0;
    let bytesOmitted = 0;
    let redactionApplied = false;
    let evidenceInconclusive = inconclusive;

    for (const change of changes) {
      if (!change.isBinary && !this.shouldRedact(change.path, redactionPatterns)) {
        const diffResult = this.buildFileDiff(change.path, change.status, normalizedBaseline, redactionPatterns);
        if (!diffResult) {
          evidenceInconclusive = true;
          continue;
        }

        if (diffResult.redacted) {
          redactionApplied = true;
        }

        const currentDiffSize = diffSizeBytes + diffResult.diff.length;
        if (currentDiffSize > diffMaxBytes) {
          diffTruncated = true;
          evidenceInconclusive = true;
          filesOmitted += 1;
          bytesOmitted += diffResult.diff.length;
          continue;
        }

        change.unifiedDiff = diffResult.diff;
        diffSizeBytes = currentDiffSize;
        if (diffResult.truncated) {
          diffTruncated = true;
          evidenceInconclusive = true;
          filesOmitted += 1;
          bytesOmitted += Math.max(0, diffResult.diff.length - 100 * 1024);
        }
      }
    }

    if (!this.workspace.gitRoot && fs.existsSync(this.workspace.root) && fs.readdirSync(this.workspace.root).length > 0) {
      evidenceInconclusive = true;
    }

    return {
      runId,
      task,
      workspace: this.workspace.root,
      baselineType: normalizedBaseline.type,
      baselineRef: normalizedBaseline.ref,
      changes,
      executionReport: executionMetadata,
      redactionApplied,
      redactionPatterns,
      diffTruncated,
      diffSizeBytes,
      diffMaxBytes,
      evidenceInconclusive,
      ...(diffTruncated && filesOmitted > 0 ? {
        truncationMetadata: {
          filesOmitted,
          bytesOmitted,
        }
      } : {}),
    };
  }

  /**
   * Convert ReviewResponse to ReviewResult for persistence in RunState.
   */
  resultFromResponse(response: ReviewResponse, baseline: ReturnType<typeof this.captureBaseline>): ReviewResult {
    return {
      verdict: response.verdict,
      findings: response.findings,
      executedAt: response.reviewedAt,
      baselineSnapshot: baseline,
      metadata: {
        providerModel: response.providerModel,
      },
    };
  }
}
