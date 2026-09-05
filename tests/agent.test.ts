import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../src/start.js';
import { Workspace } from '../src/agent/workspace.js';
import { createReadTool } from '../src/tools/read.js';
import { createWriteTool } from '../src/tools/write.js';
import { createEditTool } from '../src/tools/edit.js';
import { createDeleteTool } from '../src/tools/delete.js';
import { createCheckTool } from '../src/tools/check.js';
import { createTodoTool } from '../src/tools/todo.js';
import { createBuiltInRegistry, runAgent } from '../src/agent/agent.js';
import { createPermissions } from '../src/agent/permissions.js';

describe('mini-agent TypeScript test suite', () => {
  it('parseArgs correctly parses flags and arguments', () => {
    const parsed = parseArgs(['node', 'start.js', '-y', '--dir', '.', '--model', 'gpt-4o', 'my task']);
    expect(parsed.autoApprove).toBe(true);
    expect(parsed.customModel).toBe('gpt-4o');
    expect(parsed.task).toBe('my task');
  });

  it('Workspace containment blocks directory traversal escapes', async () => {
    const workspace = await Workspace.open(process.cwd());
    await expect(workspace.resolveExistingFile('../../../etc/passwd')).rejects.toThrow();
  });

  it('ToolRegistry contains all 11 tools', async () => {
    const workspace = await Workspace.open(process.cwd());
    const registry = createBuiltInRegistry({ workspace });
    expect(registry.has('read')).toBe(true);
    expect(registry.has('write')).toBe(true);
    expect(registry.has('edit')).toBe(true);
    expect(registry.has('patch')).toBe(true);
    expect(registry.has('delete')).toBe(true);
    expect(registry.has('glob')).toBe(true);
    expect(registry.has('grep')).toBe(true);
    expect(registry.has('bash')).toBe(true);
    expect(registry.has('check')).toBe(true);
    expect(registry.has('fetch')).toBe(true);
    expect(registry.has('todo')).toBe(true);
  });

  it('check tool executes successfully against a .ts file', async () => {
    const workspace = await Workspace.open(process.cwd());
    const env = { workspace };
    const writeTool = createWriteTool(env);
    const checkTool = createCheckTool(env);
    const deleteTool = createDeleteTool(env);

    await writeTool.execute({ path: 'test-check-file.ts', content: 'export const x: number = 42;' });
    const result = await checkTool.execute({ path: 'test-check-file.ts' });
    expect(result).toContain('exit_code: 0');

    await deleteTool.execute({ path: 'test-check-file.ts' });
  });

  it('edit tool handles CRLF vs LF line ending normalization', async () => {
    const workspace = await Workspace.open(process.cwd());
    const env = { workspace };
    const writeTool = createWriteTool(env);
    const editTool = createEditTool(env);
    const readTool = createReadTool(env);

    await writeTool.execute({ path: 'test-crlf.txt', content: 'line1\r\nline2\r\nline3' });
    await editTool.execute({ path: 'test-crlf.txt', old_text: 'line2', new_text: 'line2-modified' });

    const result = await readTool.execute({ path: 'test-crlf.txt' });
    expect(result).toContain('line2-modified');

    const deleteTool = createDeleteTool(env);
    await deleteTool.execute({ path: 'test-crlf.txt' });
  });

  it('todo tool correctly tracks and merges tasks', async () => {
    const todoTool = createTodoTool();
    await todoTool.execute({
      todos: [{ id: 'task-1', content: 'First task', status: 'pending' }],
    });
    const result = await todoTool.execute({
      todos: [{ id: 'task-1', content: 'First task', status: 'completed' }],
      merge: true,
    });
    expect(result).toContain('[completed] task-1: First task');
  });

  it('Agent loop multi-step execution with mock provider', async () => {
    const workspace = await Workspace.open(process.cwd());
    const permissions = createPermissions({ autoApprove: true }, workspace);

    let stepCount = 0;
    const mockProvider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(_request: any) {
        stepCount++;
        if (stepCount === 1) {
          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      function: {
                        name: 'todo',
                        arguments: JSON.stringify({
                          todos: [{ id: 't1', content: 'mock todo', status: 'in_progress' }],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          };
        }
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Task completed successfully in mock provider.',
              },
            },
          ],
        };
      },
    };

    const agentResult = await runAgent({
      task: 'Mock agent task',
      provider: mockProvider as any,
      permissions,
      workspace,
      maxSteps: 5,
    });

    expect(agentResult.text).toContain('Task completed successfully in mock provider');
  });
});
