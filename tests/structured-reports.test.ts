import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { DurableRun } from '../src/agent/run-state.js';

const withWorkspace = async (test: (directory: string) => Promise<void>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-reports-'));
  try {
    await test(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe('structured run reports', () => {
  it('writes stable result.json and report.md artifacts for completed runs', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'Build the feature');
      run.complete([], {
        qualityGateResults: [{ id: 'test', name: 'Tests', required: true, status: 'passed', stdout: '', stderr: '', durationMs: 12 }],
        usageSummary: {
          requests: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0.02,
          currency: 'USD', allModelsHavePricing: true, modelBreakdown: {},
        },
      });

      const result = JSON.parse(fs.readFileSync(path.join(run.directory, 'result.json'), 'utf8'));
      const report = fs.readFileSync(path.join(run.directory, 'report.md'), 'utf8');
      expect(result).toMatchObject({ version: 1, runId: run.state.id, status: 'completed', task: 'Build the feature', filesChanged: [] });
      expect(result.qualityGates[0].status).toBe('passed');
      expect(result.usage.totalTokens).toBe(15);
      expect(report).toContain('# Run Report');
      expect(report).toContain('Tests');
      expect(report).toContain('Estimated cost');
    });
  });

  it('writes failed and partially populated reports without inventing metadata', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'Fail safely');
      run.fail(new Error('verification failed'), []);
      const result = JSON.parse(fs.readFileSync(path.join(run.directory, 'result.json'), 'utf8'));
      const report = fs.readFileSync(path.join(run.directory, 'report.md'), 'utf8');
      expect(result.status).toBe('failed');
      expect(result.error).toBe('verification failed');
      expect(result.qualityGates).toEqual([]);
      expect(result.usage).toBeNull();
      expect(result.filesChanged).toEqual([]);
      expect(report).toContain('verification failed');
      expect(report).toContain('No file-change metadata recorded.');
    });
  });

  it('redacts secrets from generated JSON and markdown artifacts', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'Deploy with sk-abcdefghijklmnopqrstuvwxyz');
      run.fail('Bearer super-secret-token', []);
      const resultText = fs.readFileSync(path.join(run.directory, 'result.json'), 'utf8');
      const report = fs.readFileSync(path.join(run.directory, 'report.md'), 'utf8');
      expect(resultText).not.toContain('abcdefghijklmnopqrstuvwxyz');
      expect(report).not.toContain('super-secret-token');
      expect(resultText).toContain('[REDACTED]');
    });
  });
});
