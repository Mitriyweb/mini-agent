import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { normalizeQualityGatesConfig, executeQualityGates, discoverQualityGates } from '../src/agent/quality-gates.js';
import { resolveAgentConfig } from '../src/agent/config.js';
import { Workspace } from '../src/agent/workspace.js';
import { createPermissions } from '../src/agent/permissions.js';
import { runAgent } from '../src/agent/agent.js';

const withWorkspace = async (test: (directory: string) => Promise<void>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-quality-gates-'));
  try {
    await test(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe('quality gates', () => {
  it('normalizes valid definitions and rejects malformed required or duplicate gates', () => {
    expect(normalizeQualityGatesConfig({ gates: [{ id: 'test', command: 'bun test', required: true }] })).toMatchObject({
      enabled: true,
      gates: [{ id: 'test', name: 'test', required: true, command: 'bun test' }],
    });
    expect(() => normalizeQualityGatesConfig({ gates: [{ id: 'required' }] })).toThrow('must define a command');
    expect(() => normalizeQualityGatesConfig({ gates: [{ id: 'same', command: 'true' }, { id: 'same', command: 'true' }] })).toThrow('duplicate');
  });

  it('loads configured gates and discovers supported package scripts when enabled without gates', async () => {
    await withWorkspace(async (directory) => {
      fs.writeFileSync(path.join(directory, 'mini-agent.config.yaml'), 'quality_gates:\n  gates:\n    - id: lint\n      command: bun run check\n', 'utf8');
      expect(resolveAgentConfig({}, directory).qualityGates.gates).toMatchObject([{ id: 'lint', command: 'bun run check' }]);

      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ scripts: { test: 'bun test', build: 'bun x tsc' } }), 'utf8');
      expect(discoverQualityGates(directory).map((gate) => gate.id)).toEqual(['test', 'build']);
    });
  });

  it('captures pass, fail, optional missing-command, and timeout results', async () => {
    await withWorkspace(async (directory) => {
      const workspace = await Workspace.open(directory);
      const permissions = createPermissions({ autoApprove: true }, workspace);
      const config = normalizeQualityGatesConfig({
        gates: [
          { id: 'pass', command: 'node -e "process.stdout.write(\'ok\')"' },
          { id: 'fail', command: 'node -e "process.stderr.write(\'bad\'); process.exit(2)"' },
          { id: 'missing', required: false },
          { id: 'timeout', command: 'node -e "setTimeout(() => {}, 100)"', timeout_ms: 10 },
        ],
      });
      const results = await executeQualityGates({ config, workspace, permissions });

      expect(results.map((result) => result.status)).toEqual(['passed', 'failed', 'skipped', 'failed']);
      expect(results[0]).toMatchObject({ exitCode: 0, stdout: 'ok' });
      expect(results[1]).toMatchObject({ exitCode: 2, stderr: 'bad' });
      expect(results[2].reason).toBe('No command configured.');
      expect(results[3].exitCode).toBe('timeout');
      expect(results.every((result) => result.durationMs >= 0)).toBe(true);
    });
  });

  it('does not allow a final response to complete while a required gate fails', async () => {
    await withWorkspace(async (directory) => {
      const workspace = await Workspace.open(directory);
      const permissions = createPermissions({ autoApprove: true }, workspace);
      let calls = 0;
      const provider = {
        model: 'mock', baseURL: 'http://localhost', apiKey: 'test',
        async respond() {
          calls += 1;
          return { choices: [{ message: { role: 'assistant', content: `attempt ${calls}` } }] };
        },
      };

      await expect(runAgent({
        task: 'finish', provider: provider as any, permissions, workspace, maxSteps: 2,
        qualityGates: normalizeQualityGatesConfig({ gates: [{ id: 'must-pass', command: 'node -e "process.exit(1)"' }] }),
      })).rejects.toThrow('exceeded the maximum');
      expect(calls).toBe(2);
    });
  });
});
