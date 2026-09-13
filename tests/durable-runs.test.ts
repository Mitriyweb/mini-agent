import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { DurableRun } from '../src/agent/run-state.js';
import { runAgent } from '../src/agent/agent.js';
import { Workspace } from '../src/agent/workspace.js';
import { createPermissions } from '../src/agent/permissions.js';
import { parseArgs } from '../src/start.js';

const withWorkspace = async (test: (directory: string) => Promise<void>) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runs-'));
  try {
    await test(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

describe('durable runs', () => {
  it('parses explicit run and resume CLI commands without changing shorthand tasks', () => {
    expect(parseArgs(['node', 'start.js', 'run', 'implement', 'feature'])).toMatchObject({
      command: 'run', task: 'implement feature',
    });
    expect(parseArgs(['node', 'start.js', 'resume', 'run-123'])).toMatchObject({
      command: 'resume', runId: 'run-123', task: '',
    });
    expect(parseArgs(['node', 'start.js', 'runbook', 'notes'])).toMatchObject({ task: 'runbook notes' });
  });

  it('creates redacted state and append-only lifecycle events', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'Use sk-abcdefghijklmnopqrstuvwxyz');
      run.update(1, []);

      const state = fs.readFileSync(path.join(run.directory, 'state.json'), 'utf8');
      const events = fs.readFileSync(path.join(run.directory, 'events.jsonl'), 'utf8').trim().split('\n');
      expect(run.state.id).toMatch(/^[a-f0-9-]{36}$/);
      expect(state).toContain('sk-***[REDACTED]***');
      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(JSON.parse(events[0]).type).toBe('created');
    });
  });

  it('resumes an interrupted run without re-executing a completed tool call', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'continue work');
      run.recordToolResult('call_1', 'already completed');
      run.update(1, []);
      run.state.messages = [{
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'previous', function: { name: 'todo', arguments: '{}' } }],
      } as any];
      run.interrupt();

      const resumed = DurableRun.load(directory, run.state.id);
      resumed.resume();
      const workspace = await Workspace.open(directory);
      const permissions = createPermissions({ autoApprove: true }, workspace);
      let calls = 0;
      const provider = {
        model: 'mock', baseURL: 'http://localhost', apiKey: 'test',
        async respond() {
          calls += 1;
          if (calls === 1) {
            return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [
              { id: 'call_1', function: { name: 'todo', arguments: '{}' } },
            ] } }] };
          }
          return { choices: [{ message: { role: 'assistant', content: 'resumed successfully' } }] };
        },
      };

      const result = await runAgent({
        task: resumed.state.task, provider: provider as any, permissions, workspace, maxSteps: 3, durableRun: resumed,
      });
      expect(result.text).toBe('resumed successfully');
      expect(resumed.state.status).toBe('completed');
      expect(resumed.state.currentStep).toBe(3);
      expect(resumed.state.completedToolCalls).toHaveLength(1);
    });
  });

  it('rejects completed and corrupted runs safely', async () => {
    await withWorkspace(async (directory) => {
      const run = DurableRun.create(directory, 'done');
      run.complete([]);
      expect(() => DurableRun.load(directory, run.state.id)).toThrow('already completed');

      const corruptId = 'corrupt-run';
      const corruptDir = path.join(directory, '.mini-agent', 'runs', corruptId);
      fs.mkdirSync(corruptDir, { recursive: true });
      fs.writeFileSync(path.join(corruptDir, 'state.json'), '{not json}', 'utf8');
      expect(() => DurableRun.load(directory, corruptId)).toThrow('invalid or missing state.json');
    });
  });
});
