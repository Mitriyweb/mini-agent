import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from '../src/start.js';
import { Workspace } from '../src/agent/workspace.js';
import { createReadTool } from '../src/tools/read.js';
import { createWriteTool } from '../src/tools/write.js';
import { createEditTool } from '../src/tools/edit.js';
import { createDeleteTool } from '../src/tools/delete.js';
import { createCheckTool } from '../src/tools/check.js';
import { createGlobTool } from '../src/tools/glob.js';
import { createOpenspecTool } from '../src/tools/openspec.js';
import { createTodoTool, TodoStatus } from '../src/tools/todo.js';
import { createGrepTool } from '../src/tools/grep.js';
import { createBuiltInRegistry, runAgent } from '../src/agent/agent.js';
import { createPermissions } from '../src/agent/permissions.js';
import {
  createReadOnlyRegistry,
  runDelegatedBatch,
  type DelegatedTaskSpec,
} from '../src/agent/subagents.js';
import { INSTRUCTIONS } from '../src/agent/instructions.js';
import { formatCustomizationsPrompt } from '../src/agent/customizations.js';

describe('mini-agent TypeScript test suite', () => {
  it('includes default coding standards in agent instructions', () => {
    expect(INSTRUCTIONS).toContain('# Coding Standards');
    expect(INSTRUCTIONS).toContain('Prefer the simplest solution');
  });

  it('lists skills without loading their full content into the prompt', () => {
    const prompt = formatCustomizationsPrompt({
      skills: [
        {
          name: 'codebase-onboarding',
          description: 'Map an unfamiliar codebase.',
          dir: '.agents/skills/codebase-onboarding',
          path: '.agents/skills/codebase-onboarding/SKILL.md',
          content: 'Private skill content',
          raw: 'Private skill content',
        },
      ],
    });
    expect(prompt).toContain('codebase-onboarding');
    expect(prompt).toContain('read its SKILL.md');
    expect(prompt).not.toContain('Private skill content');
  });

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

  it('glob tool treats blank patterns as a workspace-wide match instead of failing', async () => {
    const workspace = await Workspace.open(process.cwd());
    const globTool = createGlobTool({ workspace });

    await expect(globTool.execute({ pattern: '   ' })).resolves.toContain('README.md');
  });

  it('grep tool rejects empty and whitespace-only patterns', async () => {
    const workspace = await Workspace.open(process.cwd());
    const grepTool = createGrepTool({ workspace });

    await expect(grepTool.execute({ pattern: '' })).resolves.toBe('No matches: grep pattern is empty.');
    await expect(grepTool.execute({ pattern: '   ' })).resolves.toBe('No matches: grep pattern is empty.');
  });

  it('openspec tool reads YAML specs and exposes paths and operations', async () => {
    const workspace = await Workspace.open(process.cwd());
    const env = { workspace };
    const writeTool = createWriteTool(env);
    const openspecTool = createOpenspecTool(env);

    const yaml = `openapi: 3.0.0
info:
  title: Demo API
  version: 1.0.0
paths:
  /users:
    get:
      summary: List users
      responses:
        '200':
          description: OK
`;

    await writeTool.execute({ path: 'demo-openapi.yaml', content: yaml });

    const info = await openspecTool.execute({ path: 'demo-openapi.yaml', operation: 'info' });
    expect(info).toContain('Demo API');

    const paths = await openspecTool.execute({ path: 'demo-openapi.yaml', operation: 'paths' });
    expect(paths).toContain('/users');

    const operations = await openspecTool.execute({
      path: 'demo-openapi.yaml',
      operation: 'operations',
      path_filter: '/users',
    });
    expect(operations).toContain('GET /users');

    const deleteTool = createDeleteTool(env);
    await deleteTool.execute({ path: 'demo-openapi.yaml' });
  });

  it('todo tool correctly tracks and merges tasks', async () => {
    const todoTool = createTodoTool();
    await todoTool.execute({
      todos: [{ id: 'task-1', content: 'First task', status: TodoStatus.PENDING }],
    });
    const result = await todoTool.execute({
      todos: [{ id: 'task-1', content: 'First task', status: TodoStatus.COMPLETED }],
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
                          todos: [{ id: 't1', content: 'mock todo', status: TodoStatus.IN_PROGRESS }],
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toolCallResponse = (name: string, args: Record<string, unknown>, id = `call_${Math.random().toString(36).slice(2)}`) => ({
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }],
      },
    },
  ],
});

const textResponse = (text: string) => ({
  choices: [{ message: { role: 'assistant', content: text } }],
});

const lastUserContent = (request: any): string => {
  const messages = request?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
      const content = messages[i].content;
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
  }
  return '';
};

const lastToolContent = (request: any): string => {
  const messages = request?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'tool') {
      const content = messages[i].content;
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
  }
  return '';
};

const tempWorkspace = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-subagent-'));
  return { dir, workspace: await Workspace.open(dir) };
};

const SUBAGENTS_ENABLED = { enabled: true, maxConcurrency: 4, maxSteps: 10, allowNested: false };

describe('Subagent delegation', () => {
  it('read-only registry exposes only inspection tools', async () => {
    const { workspace } = await tempWorkspace();
    const registry = createReadOnlyRegistry({ workspace });
    expect(registry.has('read')).toBe(true);
    expect(registry.has('glob')).toBe(true);
    expect(registry.has('grep')).toBe(true);
    for (const name of ['write', 'edit', 'patch', 'delete', 'bash', 'check', 'fetch', 'todo', 'openspec', 'delegate', 'claude_review', 'codex_review']) {
      expect(registry.has(name)).toBe(false);
    }
  });

  it('delegates a read-only subtask with fresh state and enforces read-only access', async () => {
    const { dir, workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    const childPrompts: string[] = [];
    let parentCalls = 0;
    let childCalls = 0;

    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated read-only subtask')) {
          childPrompts.push(userText);
          childCalls += 1;
          if (childCalls === 1) {
            // Attempt a mutation: the read-only registry has no write tool.
            return toolCallResponse('write', { path: 'evil.txt', content: 'pwned' });
          }
          return textResponse(
            `child inspection complete write-blocked=${lastToolContent(request).includes('Unknown tool requested: write')}`,
          );
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [{ task: 'inspect the workspace files', access: 'read-only' }],
          });
        }
        return textResponse('parent finished');
      },
    };

    const result = await runAgent({
      task: 'Parent task XYZ-123',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 10,
      subagents: SUBAGENTS_ENABLED,
    });

    expect(result.text).toContain('parent finished');
    expect(childPrompts).toHaveLength(2);
    // Fresh conversation state: the child never sees the parent task text.
    expect(childPrompts[0]).toContain('inspect the workspace files');
    expect(childPrompts[0]).not.toContain('Parent task XYZ-123');
    // The write attempt failed because the tool does not exist for read-only children.
    const delegateOutput = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content))
      .find((c: string) => c.includes('child inspection complete'));
    expect(delegateOutput).toBeDefined();
    expect(delegateOutput).toContain('"status": "completed"');
    expect(delegateOutput).toContain('write-blocked=true');
    await expect(fs.access(path.join(dir, 'evil.txt'))).rejects.toThrow();
  });

  it('write-capable child can modify the shared workspace', async () => {
    const { dir, workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    let parentCalls = 0;
    let childCalls = 0;

    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated write subtask')) {
          childCalls += 1;
          if (childCalls === 1) {
            return toolCallResponse('write', { path: 'child-output.txt', content: 'written by child' });
          }
          return textResponse('child wrote the file');
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [{ task: 'create child-output.txt', access: 'write' }],
          });
        }
        return textResponse('parent done');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 10,
      subagents: SUBAGENTS_ENABLED,
    });

    expect(result.text).toContain('parent done');
    const content = await fs.readFile(path.join(dir, 'child-output.txt'), 'utf8');
    expect(content).toBe('written by child');
    const delegateOutput = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content))
      .find((c: string) => c.includes('child wrote the file'));
    expect(delegateOutput).toContain('"status": "completed"');
  });

  it('reports child failures explicitly instead of success-shaped output', async () => {
    const { workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    let parentCalls = 0;

    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated read-only subtask')) {
          throw new Error('provider boom');
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [{ task: 'doomed task', access: 'read-only' }],
          });
        }
        return textResponse('parent recovered');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 10,
      subagents: SUBAGENTS_ENABLED,
    });

    const delegateOutput = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content))
      .find((c: string) => c.includes('"status"'));
    expect(delegateOutput).toContain('"status": "failed"');
    expect(delegateOutput).toContain('provider boom');
  });

  it('does not register delegation for children when allowNested is false', async () => {
    const { workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    let parentCalls = 0;
    let childCalls = 0;

    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated write subtask')) {
          childCalls += 1;
          if (childCalls === 1) {
            return toolCallResponse('delegate', {
              tasks: [{ task: 'grandchild task', access: 'read-only' }],
            });
          }
          // Echo back whatever the delegate tool call produced.
          return textResponse(`child saw: ${lastToolContent(request).slice(0, 120)}`);
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [{ task: 'try to nest', access: 'write' }],
          });
        }
        return textResponse('parent done');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 12,
      subagents: SUBAGENTS_ENABLED,
    });

    const delegateOutput = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content))
      .find((c: string) => c.includes('child saw:'));
    expect(delegateOutput).toContain('Unknown tool requested: delegate');
  });

  it('bounds concurrent children by maxConcurrency and reports per-task results', async () => {
    const { workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    let active = 0;
    let peak = 0;
    let parentCalls = 0;

    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated read-only subtask')) {
          active += 1;
          peak = Math.max(peak, active);
          await sleep(30);
          active -= 1;
          return textResponse(`done: ${userText.slice(-20)}`);
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [1, 2, 3, 4].map((n) => ({ task: `parallel task ${n}`, access: 'read-only' })),
          });
        }
        return textResponse('parent done');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 10,
      subagents: { ...SUBAGENTS_ENABLED, maxConcurrency: 2 },
    });

    expect(result.text).toContain('parent done');
    expect(peak).toBe(2);
    const delegateOutput = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content))
      .find((c: string) => c.includes('parallel task'));
    expect(delegateOutput).toBeDefined();
    expect((delegateOutput!.match(/"status": "completed"/g) ?? []).length).toBe(4);
  });

  it('rejects delegation explicitly when disabled', async () => {
    const { workspace } = await tempWorkspace();
    const permissions = createPermissions({ autoApprove: true }, workspace);
    const registry = createBuiltInRegistry({ workspace });
    // The delegate tool is only injected by runAgent when enabled; the base
    // registry must never contain it.
    expect(registry.has('delegate')).toBe(false);

    let calls = 0;
    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond() {
        calls += 1;
        if (calls === 1) {
          return toolCallResponse('delegate', { tasks: [{ task: 'x', access: 'read-only' }] });
        }
        return textResponse('done without delegation');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 5,
      subagents: { ...SUBAGENTS_ENABLED, enabled: false },
    });
    expect(result.text).toContain('done without delegation');
    const toolOutputs = result.messages
      .filter((m: any) => m.role === 'tool')
      .map((m: any) => String(m.content));
    expect(toolOutputs.some((c: string) => c.includes('Unknown tool requested: delegate'))).toBe(true);
  });

  it('runDelegatedBatch propagates cancellation and marks unstarted tasks interrupted', async () => {
    const controller = new AbortController();
    const specs: DelegatedTaskSpec[] = [
      { task: 'first', access: 'read-only' },
      { task: 'second', access: 'read-only' },
      { task: 'third', access: 'read-only' },
    ];
    const promise = runDelegatedBatch(specs, {
      concurrency: 1,
      signal: controller.signal,
      runChild: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('child aborted')), { once: true });
        }),
    });
    setTimeout(() => controller.abort(), 10);
    const results = await promise;
    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('interrupted');
    expect(results[1].status).toBe('interrupted');
    expect(results[2].status).toBe('interrupted');
  });

  it('serializes interactive approvals across concurrent write children', async () => {
    const { workspace } = await tempWorkspace();
    let activeApprovals = 0;
    let peakApprovals = 0;
    const permissions = createPermissions(
      {
        askDecision: async () => {
          activeApprovals += 1;
          peakApprovals = Math.max(peakApprovals, activeApprovals);
          await sleep(15);
          activeApprovals -= 1;
          return true;
        },
      },
      workspace,
    );

    let parentCalls = 0;
    const provider = {
      model: 'mock-model',
      baseURL: 'http://localhost',
      apiKey: 'dummy',
      async respond(request: any) {
        const userText = lastUserContent(request);
        if (userText.includes('Delegated write subtask')) {
          if (!lastToolContent(request) && !request.messages.some((m: any) => m.role === 'tool')) {
            return toolCallResponse('write', { path: `f-${Math.random().toString(36).slice(2, 8)}.txt`, content: 'x' });
          }
          return textResponse('child wrote');
        }
        parentCalls += 1;
        if (parentCalls === 1) {
          return toolCallResponse('delegate', {
            tasks: [
              { task: 'write file A', access: 'write' },
              { task: 'write file B', access: 'write' },
            ],
          });
        }
        return textResponse('parent done');
      },
    };

    const result = await runAgent({
      task: 'parent',
      provider: provider as any,
      permissions,
      workspace,
      maxSteps: 10,
      subagents: { ...SUBAGENTS_ENABLED, maxConcurrency: 2 },
    });

    expect(result.text).toContain('parent done');
    expect(peakApprovals).toBe(1);
  });
});
