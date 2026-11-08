import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTasksMarkdown, updateTaskInMarkdown, loadOpenSpecChange, markTaskCompleteInFile } from '../src/agent/orchestrator/openspec-parser.ts';
import { buildExecutionPlan } from '../src/agent/orchestrator/task-planner.ts';
import { selectNextTask, areDependenciesSatisfied } from '../src/agent/orchestrator/task-selector.ts';
import { buildTaskPrompt } from '../src/agent/orchestrator/task-context.ts';
import { OpenSpecOrchestrator } from '../src/agent/orchestrator/orchestrator.ts';
import { parseArgs, ParsedCommand } from '../src/start.ts';
import { Workspace } from '../src/agent/workspace.ts';

describe('OpenSpec Orchestrator Test Suite', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-orchestrator-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('1. Parsing OpenSpec task lists with various checkbox formats', () => {
    const markdown = `# Tasks

## 1. Core Models
- [ ] 1.1 Create User entity
- [x] 1.2 Add migrations
- [X] 1.3 Add seed data
- [ x] 1.4 Add indexes

## 2. API Endpoints
* [ ] 2.1 Implement login route
- [ ] 2.2 Implement logout route [depends on: 2.1] [specs: auth]
- [~] 2.3 Non-standard marker should be incomplete
`;
    const tasks = parseTasksMarkdown(markdown);
    expect(tasks.length).toBe(7);

    expect(tasks[0].id).toBe('1.1');
    expect(tasks[0].description).toBe('Create User entity');
    expect(tasks[0].completed).toBe(false);
    expect(tasks[0].section).toBe('1. Core Models');

    expect(tasks[1].id).toBe('1.2');
    expect(tasks[1].completed).toBe(true);

    expect(tasks[2].id).toBe('1.3');
    expect(tasks[2].completed).toBe(true);

    expect(tasks[3].id).toBe('1.4');
    expect(tasks[3].completed).toBe(true);

    expect(tasks[4].id).toBe('2.1');
    expect(tasks[4].completed).toBe(false);
    expect(tasks[4].section).toBe('2. API Endpoints');

    expect(tasks[5].id).toBe('2.2');
    expect(tasks[5].dependencies).toEqual(['2.1']);
    expect(tasks[5].specs).toEqual(['auth']);

    expect(tasks[6].id).toBe('2.3');
    expect(tasks[6].completed).toBe(false);
  });

  it('2. Handling completed and incomplete tasks & 3. Preserving task order', () => {
    const markdown = `
- [x] 1. First task
- [ ] 2. Second task
- [x] 3. Third task
- [ ] 4. Fourth task
`;
    const tasks = parseTasksMarkdown(markdown);
    const plan = buildExecutionPlan(tasks);

    expect(plan.totalTasks).toBe(4);
    expect(plan.completedTasks).toBe(2);
    expect(plan.pendingTasks).toBe(2);

    expect(plan.tasks.map((t) => t.id)).toEqual(['1', '2', '3', '4']);
    expect(plan.tasks.map((t) => t.index)).toEqual([1, 2, 3, 4]);
  });

  it('4. Dependency handling (explicit dependencies) and 5. Selecting next eligible task', () => {
    const tasks = parseTasksMarkdown(`
- [ ] 1. Base database setup
- [ ] 2. Authentication service [depends on: 1]
- [ ] 3. Independent utility task
`);
    const plan = buildExecutionPlan(tasks);

    // Initial: task 1 has no deps, so it is eligible
    const first = selectNextTask(plan.tasks);
    expect(first?.id).toBe('1');

    // If task 1 is not done, task 2 cannot be selected even if checked
    expect(areDependenciesSatisfied(plan.tasks[1], plan.tasks)).toBe(false);

    // Mark task 1 complete
    plan.tasks[0].completed = true;
    expect(areDependenciesSatisfied(plan.tasks[1], plan.tasks)).toBe(true);

    const next = selectNextTask(plan.tasks);
    expect(next?.id).toBe('2');
  });

  it('6. Atomic update in markdown preserves formatting and other content', () => {
    const original = `# Tasks
<!-- Some comment -->

## Section 1
- [ ] 1.1 Do first
- [ ] 1.2 Do second

## Section 2
- [ ] 2.1 Do third
`;
    const { updatedContent, found } = updateTaskInMarkdown(original, '1.1', true);
    expect(found).toBe(true);
    expect(updatedContent).toContain('- [x] 1.1 Do first');
    expect(updatedContent).toContain('- [ ] 1.2 Do second');
    expect(updatedContent).toContain('<!-- Some comment -->');
  });

  it('7. Task Context Builder includes change objective, current task, and error feedback', () => {
    const context = {
      changeName: 'test-change',
      changeDir: tempDir,
      tasksFilePath: path.join(tempDir, 'tasks.md'),
      tasks: [],
      proposal: 'Add user auth',
      design: 'Use JWT tokens',
      specs: { 'auth.md': 'Must return 401 on missing token' },
      otherFiles: {},
    };
    const currentTask = {
      id: '1.2',
      rawText: '- [ ] 1.2 Implement login',
      description: 'Implement login',
      completed: false,
      section: 'Auth',
      dependencies: [],
      specs: ['auth'],
      lineNumber: 5,
      index: 2,
      total: 3,
    };
    const allTasks = [
      { ...currentTask, id: '1.1', index: 1, completed: true, description: 'User schema' },
      currentTask,
      { ...currentTask, id: '1.3', index: 3, completed: false, description: 'Logout' },
    ];

    const prompt1 = buildTaskPrompt({
      changeContext: context,
      currentTask,
      allTasks,
      attempt: 1,
    });

    expect(prompt1).toContain('Task 2 of 3');
    expect(prompt1).toContain('Implement login');
    expect(prompt1).toContain('Add user auth');
    expect(prompt1).toContain('Must return 401 on missing token');
    expect(prompt1).toContain('[x] 1.1: User schema');
    expect(prompt1).toContain('[ ] 1.2: Implement login <-- [CURRENT TASK]');

    // With retry / error context
    const prompt2 = buildTaskPrompt({
      changeContext: context,
      currentTask,
      allTasks,
      attempt: 2,
      maxAttempts: 3,
      lastError: 'Syntax error at line 42',
      gateFailures: 'Test suite failed',
    });

    expect(prompt2).toContain('Previous Attempt Failed (Attempt 2/3)');
    expect(prompt2).toContain('Syntax error at line 42');
    expect(prompt2).toContain('Test suite failed');
  });

  it('8. Orchestrator successful task execution loop and tasks.md update', async () => {
    // Setup change dir structure
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'add-feature');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(
      tasksPath,
      `# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n`,
      'utf8',
    );

    const workspace = await Workspace.open(tempDir);
    const mockProvider = {
      providerId: 'mock',
      model: 'mock-model',
      baseURL: 'http://localhost',
      respond: async () => ({ choices: [{ message: { role: 'assistant', content: 'Done' } }] }),
    } as any;

    const mockPermissions = {
      approve: async () => true,
      close: () => {},
    } as any;

    const executedTasks: string[] = [];
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'add-feature',
      provider: mockProvider,
      permissions: mockPermissions,
      agentRunner: async (options) => {
        // Mock runner
        executedTasks.push(options.task);
        return { text: 'Done', messages: [] };
      },
    });

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(2);
    expect(result.failedTasks).toBe(0);
    expect(executedTasks.length).toBe(2);

    const updatedTasksMd = fs.readFileSync(tasksPath, 'utf8');
    expect(updatedTasksMd).toContain('- [x] 1.1 First task');
    expect(updatedTasksMd).toContain('- [x] 1.2 Second task');
  });

  it('9. Orchestrator bounded retries and failing task prevents completion', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'failing-change');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(
      tasksPath,
      `# Tasks\n\n- [ ] 1.1 Will fail\n- [ ] 1.2 Should not be attempted\n`,
      'utf8',
    );

    const workspace = await Workspace.open(tempDir);
    const mockProvider = {} as any;
    const mockPermissions = { approve: async () => true, close: () => {} } as any;

    let attempts = 0;
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'failing-change',
      provider: mockProvider,
      permissions: mockPermissions,
      maxRetries: 3,
      agentRunner: async () => {
        attempts++;
        throw new Error('Build error in task');
      },
    });

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.completedTasks).toBe(0);
    expect(result.failedTasks).toBe(2);
    expect(attempts).toBe(4); // 1 initial attempt + 3 retries = 4 attempts

    const updatedTasksMd = fs.readFileSync(tasksPath, 'utf8');
    expect(updatedTasksMd).toContain('- [ ] 1.1 Will fail');
    expect(updatedTasksMd).toContain('- [ ] 1.2 Should not be attempted');
  });

  it('10. Bounded retries: succeeds on second attempt after first failure', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'retry-change');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(
      tasksPath,
      `# Tasks\n\n- [ ] 1.1 Flaky task\n`,
      'utf8',
    );

    const workspace = await Workspace.open(tempDir);
    const mockProvider = {} as any;
    const mockPermissions = { approve: async () => true, close: () => {} } as any;

    let attempts = 0;
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'retry-change',
      provider: mockProvider,
      permissions: mockPermissions,
      maxRetries: 3,
      agentRunner: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('First attempt failed');
        }
        return { text: 'Fixed', messages: [] };
      },
    });

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.completedTasks).toBe(1);
    expect(attempts).toBe(2);

    const updatedTasksMd = fs.readFileSync(tasksPath, 'utf8');
    expect(updatedTasksMd).toContain('- [x] 1.1 Flaky task');
  });

  it('11. Recovery after interruption: resumes without repeating completed tasks', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'resume-change');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    // Task 1.1 is already completed, Task 1.2 is incomplete
    fs.writeFileSync(
      tasksPath,
      `# Tasks\n\n- [x] 1.1 Already done\n- [ ] 1.2 Needs execution\n`,
      'utf8',
    );

    const workspace = await Workspace.open(tempDir);
    const mockProvider = {} as any;
    const mockPermissions = { approve: async () => true, close: () => {} } as any;

    const attemptedTasks: string[] = [];
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'resume-change',
      provider: mockProvider,
      permissions: mockPermissions,
      agentRunner: async (options) => {
        attemptedTasks.push(options.task);
        return { text: 'Done', messages: [] };
      },
    });

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(2);
    expect(attemptedTasks.length).toBe(1); // Only 1.2 was executed
    expect(attemptedTasks[0]).toContain('1.2');

    const updatedTasksMd = fs.readFileSync(tasksPath, 'utf8');
    expect(updatedTasksMd).toContain('- [x] 1.1 Already done');
    expect(updatedTasksMd).toContain('- [x] 1.2 Needs execution');
  });

  it('12. Handling missing or malformed OpenSpec files', async () => {
    const workspace = await Workspace.open(tempDir);

    // Non-existent change
    await expect(loadOpenSpecChange(workspace.root, 'non-existent')).rejects.toThrow(
      'OpenSpec change directory not found',
    );

    // Empty change name
    await expect(loadOpenSpecChange(workspace.root, '')).rejects.toThrow(
      'Change name must not be empty.',
    );

    // Missing tasks.md
    const invalidChangeDir = path.join(tempDir, 'openspec', 'changes', 'no-tasks');
    fs.mkdirSync(invalidChangeDir, { recursive: true });
    await expect(loadOpenSpecChange(workspace.root, 'no-tasks')).rejects.toThrow(
      'OpenSpec tasks file not found',
    );
  });

  it('13. Handling cancellation via AbortSignal', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'cancel-change');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(
      tasksPath,
      `# Tasks\n\n- [ ] 1.1 Task one\n- [ ] 1.2 Task two\n`,
      'utf8',
    );

    const workspace = await Workspace.open(tempDir);
    const mockProvider = {} as any;
    const mockPermissions = { approve: async () => true, close: () => {} } as any;

    const controller = new AbortController();
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'cancel-change',
      provider: mockProvider,
      permissions: mockPermissions,
      signal: controller.signal,
      agentRunner: async () => {
        // Abort right after first task executes
        controller.abort();
        return { text: 'Done', messages: [] };
      },
    });

    const result = await orchestrator.run();
    expect(result.success).toBe(false);
    expect(result.completedTasks).toBe(1); // Task 1.1 finished before abort stopped 1.2
  });

  it('14. CLI parseArgs correctly parses mini-agent apply command', () => {
    const parsed = parseArgs(['node', 'mini-agent', 'apply', 'my-change', '--max-retries', '5', '-y']);
    expect(parsed.command).toBe(ParsedCommand.Apply);
    expect(parsed.changeName).toBe('my-change');
    expect(parsed.maxRetries).toBe(5);
    expect(parsed.autoApprove).toBe(true);
  });

  it('15. Path traversal attempts in changeName are rejected', async () => {
    const workspace = await Workspace.open(tempDir);

    await expect(loadOpenSpecChange(workspace.root, '../../etc/passwd')).rejects.toThrow(
      'Invalid OpenSpec change name.',
    );

    await expect(loadOpenSpecChange(workspace.root, '..')).rejects.toThrow(
      'Invalid OpenSpec change name.',
    );

    await expect(loadOpenSpecChange(workspace.root, '.')).rejects.toThrow(
      'Invalid OpenSpec change name.',
    );

    await expect(loadOpenSpecChange(workspace.root, 'subdir/nested')).rejects.toThrow(
      'Invalid OpenSpec change name.',
    );
  });

  it('16. Duplicate task IDs in tasks.md are rejected', () => {
    const markdown = `# Tasks
- [ ] 1.1 First task
- [ ] 1.1 Duplicate task
`;
    expect(() => parseTasksMarkdown(markdown)).toThrow("Duplicate task ID '1.1' found");
  });

  it('17. Circular dependencies and missing dependency diagnostics', () => {
    // Missing dependency
    const tasksWithMissing = parseTasksMarkdown(`
- [ ] 1.1 Task A [depends on: 9.9]
`);
    const planWithMissing = buildExecutionPlan(tasksWithMissing);
    const next = selectNextTask(planWithMissing.tasks);
    expect(next).toBe(null);

    // Circular dependency
    const tasksWithCycle = parseTasksMarkdown(`
- [ ] 1.1 Task A [depends on: 1.2]
- [ ] 1.2 Task B [depends on: 1.1]
`);
    const planWithCycle = buildExecutionPlan(tasksWithCycle);
    const nextCycle = selectNextTask(planWithCycle.tasks);
    expect(nextCycle).toBe(null);
  });

  it('18. maxRetries = 0 allows exactly 1 attempt', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'zero-retries');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(tasksPath, `# Tasks\n- [ ] 1.1 Task\n`, 'utf8');

    const workspace = await Workspace.open(tempDir);
    let attempts = 0;
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'zero-retries',
      provider: {} as any,
      permissions: { approve: async () => true, close: () => {} } as any,
      maxRetries: 0,
      agentRunner: async () => {
        attempts++;
        throw new Error('Immediate failure');
      },
    });

    const result = await orchestrator.run();
    expect(result.success).toBe(false);
    expect(attempts).toBe(1); // Exactly 1 attempt with 0 retries
  });

  it('19. Negative maxRetries throws validation error', async () => {
    const workspace = await Workspace.open(tempDir);
    expect(() => {
      new OpenSpecOrchestrator({
        workspace,
        changeName: 'test',
        provider: {} as any,
        permissions: {} as any,
        maxRetries: -1,
      });
    }).toThrow('maxRetries must be a non-negative integer');
  });

  it('20. Quality Gates execute once via agentRunner result', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'qg-once');
    fs.mkdirSync(changeDir, { recursive: true });
    const tasksPath = path.join(changeDir, 'tasks.md');
    fs.writeFileSync(tasksPath, `# Tasks\n- [ ] 1.1 Task with gates\n`, 'utf8');

    const workspace = await Workspace.open(tempDir);
    let agentCallCount = 0;

    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'qg-once',
      provider: {} as any,
      permissions: { approve: async () => true, close: () => {} } as any,
      agentRunner: async () => {
        agentCallCount++;
        return {
          text: 'Done',
          messages: [],
          qualityGateResults: [
            { id: 'test', name: 'test', required: true, status: 'passed', stdout: '', stderr: '', durationMs: 10 },
          ],
        };
      },
    });

    const result = await orchestrator.run();
    expect(result.success).toBe(true);
    expect(agentCallCount).toBe(1);
    expect(result.results[0].qualityGateResults?.length).toBe(1);
    expect(result.results[0].qualityGateResults?.[0].status).toBe('passed');
  });

  it('21. Empty tasks.md handles gracefully in parser and rejects in orchestrator', async () => {
    const tasks = parseTasksMarkdown('');
    expect(tasks.length).toBe(0);
    const plan = buildExecutionPlan(tasks);
    expect(plan.totalTasks).toBe(0);
    expect(plan.completedTasks).toBe(0);
    expect(selectNextTask(plan.tasks)).toBe(null);

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'empty-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks\n', 'utf8');

    const workspace = await Workspace.open(tempDir);
    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'empty-change',
      provider: {} as any,
      permissions: { approve: async () => true, close: () => {} } as any,
    });

    await expect(orchestrator.run()).rejects.toThrow('contains no executable tasks in tasks.md');
  });

  it('22. Symlink directory escaping changesDir is rejected', async () => {
    const workspace = await Workspace.open(tempDir);
    const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'external-change-'));
    fs.writeFileSync(path.join(externalDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Ext\n', 'utf8');

    const changesDir = path.join(tempDir, 'openspec', 'changes');
    fs.mkdirSync(changesDir, { recursive: true });
    const symlinkPath = path.join(changesDir, 'symlinked-change');
    fs.symlinkSync(externalDir, symlinkPath);

    await expect(loadOpenSpecChange(workspace.root, 'symlinked-change')).rejects.toThrow(
      'OpenSpec change symlink escapes changes directory.',
    );

    fs.rmSync(externalDir, { recursive: true, force: true });
  });

  it('23. Symlink tasks.md escaping change directory is rejected', async () => {
    const workspace = await Workspace.open(tempDir);
    const externalTasks = path.join(os.tmpdir(), `external-tasks-${Date.now()}.md`);
    fs.writeFileSync(externalTasks, '# Tasks\n- [ ] 1.1 Ext\n', 'utf8');

    const changeDir = path.join(tempDir, 'openspec', 'changes', 'symlink-task-change');
    fs.mkdirSync(changeDir, { recursive: true });
    const symlinkTasks = path.join(changeDir, 'tasks.md');
    fs.symlinkSync(externalTasks, symlinkTasks);

    await expect(loadOpenSpecChange(workspace.root, 'symlink-task-change')).rejects.toThrow(
      'OpenSpec tasks file symlink escapes change directory.',
    );

    fs.unlinkSync(externalTasks);
  });

  it('24. Hierarchical task IDs (1.1.1, 1.1.2) parse correctly with dependencies', () => {
    const markdown = `# Tasks
- [ ] 1.1 Base auth
- [ ] 1.1.1 Token parsing
- [ ] 1.1.2 Refresh flow [depends on: 1.1.1]
`;
    const tasks = parseTasksMarkdown(markdown);
    expect(tasks.length).toBe(3);
    expect(tasks[0].id).toBe('1.1');
    expect(tasks[1].id).toBe('1.1.1');
    expect(tasks[2].id).toBe('1.1.2');
    expect(tasks[2].dependencies).toEqual(['1.1.1']);
  });

  it('25. AbortSignal propagates to runAgent and stops execution', async () => {
    const changeDir = path.join(tempDir, 'openspec', 'changes', 'signal-prop-change');
    fs.mkdirSync(changeDir, { recursive: true });
    fs.writeFileSync(path.join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Long task\n', 'utf8');

    const workspace = await Workspace.open(tempDir);
    const controller = new AbortController();
    let runnerSignalReceived: boolean | undefined;

    const orchestrator = new OpenSpecOrchestrator({
      workspace,
      changeName: 'signal-prop-change',
      provider: {} as any,
      permissions: { approve: async () => true, close: () => {} } as any,
      signal: controller.signal,
      agentRunner: async (options) => {
        runnerSignalReceived = options.signal !== undefined;
        controller.abort();
        if (options.signal?.aborted) {
          throw new Error('Agent execution aborted.');
        }
        return { text: 'Done', messages: [] };
      },
    });

    const result = await orchestrator.run();
    expect(runnerSignalReceived).toBe(true);
    expect(result.success).toBe(false);
  });
});
