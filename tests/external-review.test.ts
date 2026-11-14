import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ReviewOrchestrator, type ReviewConfig } from '../src/agent/review-orchestrator.js';
import { executeReview, MalformedReviewResponseError } from '../src/agent/review-provider.js';
import type { ReviewRequest, ReviewResponse, ReviewResult } from '../src/agent/review-types.js';
import { BaselineType, ReviewVerdict, ExecutionStatus, ReviewResultStatus } from '../src/agent/review-types.js';
import type { Provider } from '../src/types/llm.js';
import { Workspace } from '../src/agent/workspace.js';

describe('External Review: ReviewOrchestrator', () => {
  let tempDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    tempDir = `${import.meta.dir}/../.test-workspace-${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    workspace = new Workspace(tempDir, tempDir, null);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  describe('isEnabled', () => {
    it('returns false when review is disabled', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);
      expect(orchestrator.isEnabled()).toBe(false);
    });

    it('returns false when enabled but no authorized provider', () => {
      const config: ReviewConfig = { enabled: true };
      const orchestrator = new ReviewOrchestrator(workspace, config);
      expect(orchestrator.isEnabled()).toBe(false);
    });

    it('returns true when enabled with authorized provider', () => {
      const config: ReviewConfig = { enabled: true, authorizedProvider: 'test-provider' };
      const orchestrator = new ReviewOrchestrator(workspace, config);
      expect(orchestrator.isEnabled()).toBe(true);
    });
  });

  describe('captureBaseline', () => {
    it('returns creation-state when not in Git', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);
      const baseline = orchestrator.captureBaseline();
      expect(baseline.type).toBe('creation-state');
      expect(baseline.ref).toBeUndefined();
    });
  });

  describe('buildReviewRequest', () => {
    it('creates ReviewRequest with metadata', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);

      const request = orchestrator.buildReviewRequest('test-run-1', 'test task', {
        status: ExecutionStatus.COMPLETED,
        stepsCompleted: 5,
        toolsUsed: ['bash', 'read'],
        messageCount: 10,
        updatedAt: new Date().toISOString(),
      });

      expect(request.runId).toBe('test-run-1');
      expect(request.task).toBe('test task');
      expect(request.workspace).toBe(workspace.root);
      expect(request.baselineType).toBe(BaselineType.CREATION_STATE);
      expect(request.redactionApplied).toBe(false);
      expect(request.diffTruncated).toBe(false);
      expect(typeof request.diffSizeBytes).toBe('number');
      expect(typeof request.diffMaxBytes).toBe('number');
    });

    it('marks evidence inconclusive for non-Git workspaces with files', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);
      fs.writeFileSync(path.join(tempDir, 'local.txt'), 'hello');

      const request = orchestrator.buildReviewRequest('test-run-2', 'task', {
        status: ExecutionStatus.COMPLETED,
        stepsCompleted: 1,
        toolsUsed: [],
        messageCount: 1,
        updatedAt: new Date().toISOString(),
      });

      expect(request.evidenceInconclusive).toBe(true);
    });

    it('rejects path traversal attempts before reading files', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);

      expect((orchestrator as any).resolveContainedPath('../outside.txt')).toBeNull();
      expect((orchestrator as any).resolveContainedPath('nested/file.txt')).toBe(path.join(tempDir, 'nested', 'file.txt'));

      fs.symlinkSync(path.dirname(tempDir), path.join(tempDir, 'escape'));
      expect((orchestrator as any).resolveContainedPath('escape')).toBeNull();
    });

    it('marks redaction as applied when a secret is present', () => {
      const config: ReviewConfig = { enabled: false };
      const gitWorkspace = new Workspace(tempDir, tempDir, tempDir);
      const orchestrator = new ReviewOrchestrator(gitWorkspace, config);
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(tempDir, 'config.txt'), 'API_KEY=sk-1234567890abcdef');
      execSync('git add config.txt', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });
      fs.appendFileSync(path.join(tempDir, 'config.txt'), '\nAPI_KEY=sk-1234567890abcdef');

      const request = orchestrator.buildReviewRequest('test-run-3', 'task', {
        type: BaselineType.GIT_HEAD,
        ref: execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf8' }).trim(),
        timestamp: new Date().toISOString(),
      }, {
        status: ExecutionStatus.COMPLETED,
        stepsCompleted: 1,
        toolsUsed: [],
        messageCount: 1,
        updatedAt: new Date().toISOString(),
      });

      expect(request.redactionApplied).toBe(true);
    });
  });

  describe('resultFromResponse', () => {
    it('converts ReviewResponse to ReviewResult', () => {
      const config: ReviewConfig = { enabled: false };
      const orchestrator = new ReviewOrchestrator(workspace, config);

      const response: ReviewResponse = {
        verdict: ReviewVerdict.PASS,
        findings: 'Execution looks good',
        reviewedAt: new Date().toISOString(),
        providerModel: 'claude-3',
      };

      const baseline = { type: BaselineType.CREATION_STATE };
      const result = orchestrator.resultFromResponse(response, baseline);

      expect(result.verdict).toBe(ReviewVerdict.PASS);
      expect(result.findings).toBe('Execution looks good');
      expect(result.baselineSnapshot).toEqual(baseline);
      expect(result.metadata?.providerModel).toBe('claude-3');
    });
  });
});

describe('External Review: Review Verdicts', () => {
  it('supports pass verdict', () => {
    const result: ReviewResult = {
      verdict: ReviewVerdict.PASS,
      findings: 'All checks passed',
      executedAt: new Date().toISOString(),
      status: ReviewResultStatus.SUCCESS,
    };
    expect(result.verdict).toBe(ReviewVerdict.PASS);
  });

  describe('External Review: Provider errors', () => {
    it('uses a typed error for malformed reviewer output', async () => {
      const provider: Provider = {
        providerId: 'test',
        model: 'test-model',
        baseURL: 'https://example.invalid',
        apiKey: 'dummy',
        respond: async () => ({ choices: [{ message: { content: 'not JSON' } }] }),
      };

      await expect(executeReview(provider, {
        runId: 'test-run',
        task: 'test task',
        workspace: '/workspace',
        baselineType: BaselineType.CREATION_STATE,
        changes: [],
        redactionApplied: false,
        diffTruncated: false,
        diffSizeBytes: 0,
        diffMaxBytes: 500 * 1024,
      })).rejects.toBeInstanceOf(MalformedReviewResponseError);
    });
  });

  it('supports fail verdict', () => {
    const result: ReviewResult = {
      verdict: ReviewVerdict.FAIL,
      findings: 'Issues found in implementation',
      executedAt: new Date().toISOString(),
      status: ReviewResultStatus.SUCCESS,
    };
    expect(result.verdict).toBe(ReviewVerdict.FAIL);
  });

  it('supports human_review_needed verdict', () => {
    const result: ReviewResult = {
      verdict: ReviewVerdict.HUMAN_REVIEW_NEEDED,
      findings: 'Needs manual verification',
      executedAt: new Date().toISOString(),
      status: ReviewResultStatus.SUCCESS,
    };
    expect(result.verdict).toBe(ReviewVerdict.HUMAN_REVIEW_NEEDED);
  });

  it('handles provider failure status', () => {
    const result: ReviewResult = {
      verdict: ReviewVerdict.HUMAN_REVIEW_NEEDED,
      findings: 'Review service unavailable',
      executedAt: new Date().toISOString(),
      status: ReviewResultStatus.PROVIDER_FAILURE,
    };
    expect(result.status).toBe(ReviewResultStatus.PROVIDER_FAILURE);
  });

  it('handles malformed response status', () => {
    const result: ReviewResult = {
      verdict: ReviewVerdict.HUMAN_REVIEW_NEEDED,
      findings: 'Reviewer returned invalid response',
      executedAt: new Date().toISOString(),
      status: ReviewResultStatus.MALFORMED_RESPONSE,
    };
    expect(result.status).toBe(ReviewResultStatus.MALFORMED_RESPONSE);
  });
});

describe('External Review: Data Safety', () => {
  let tempDir: string;
  let workspace: Workspace;

  beforeEach(() => {
    tempDir = `${import.meta.dir}/../.test-workspace-safety-${Date.now()}`;
    fs.mkdirSync(tempDir, { recursive: true });
    workspace = new Workspace(tempDir, tempDir, null);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('respects max diff size limit', () => {
    const config: ReviewConfig = { enabled: false };
    const orchestrator = new ReviewOrchestrator(workspace, config);

    const largeContent = 'x'.repeat(600 * 1024);
    fs.writeFileSync(path.join(tempDir, 'large.txt'), largeContent);

    const request = orchestrator.buildReviewRequest('run-1', 'task', {
      status: 'completed',
      stepsCompleted: 1,
      toolsUsed: [],
      messageCount: 1,
      updatedAt: new Date().toISOString(),
    });

    expect(request.diffSizeBytes).toBeLessThanOrEqual(request.diffMaxBytes + 1024);
  });
});
