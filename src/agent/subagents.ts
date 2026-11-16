import { createGlobTool } from '../tools/glob.ts';
import { createGrepTool } from '../tools/grep.ts';
import { createReadTool } from '../tools/read.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';
import type { Permissions } from '../types/permissions.ts';
import { SubagentPhase, type AgentEvent } from '../types/agent.ts';
import type { UsageSummary } from './usage-tracker.ts';
import { ToolRegistry } from '../tools/registry.ts';

/**
 * Configurable child-agent (subagent) delegation.
 *
 * Delegation is opt-in: with `enabled: false` (the default) no delegate tool is
 * registered and agent behavior is unchanged. Children always run with fresh
 * conversation state in the same workspace; read-only children receive a
 * restricted tool registry, write-capable children receive the full registry
 * and the normal permission flow.
 */

export interface SubagentsConfig {
  /** Master switch for child-agent delegation. Default false. */
  enabled: boolean;
  /** Maximum number of child tasks running concurrently per delegate call. Default 4. */
  maxConcurrency: number;
  /** Default per-child step limit when a task does not specify maxSteps. Default 30. */
  maxSteps: number;
  /** Allow write-capable children to delegate further (bounded by MAX_SUBAGENT_DEPTH). Default false. */
  allowNested: boolean;
}

export const DEFAULT_SUBAGENTS_CONFIG: SubagentsConfig = {
  enabled: false,
  maxConcurrency: 4,
  maxSteps: 30,
  allowNested: false,
};

/** Hard cap on delegation depth so nested delegation can never recurse unboundedly. */
export const MAX_SUBAGENT_DEPTH = 4;

/** Maximum number of subtasks accepted by a single delegate call. */
export const MAX_DELEGATED_TASKS = 16;

export const validateSubagentsConfig = (config: Partial<SubagentsConfig>): void => {
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`subagents.enabled must be a boolean (true/false), got: ${typeof config.enabled} (${config.enabled})`);
  }
  if (config.maxConcurrency !== undefined) {
    if (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1) {
      throw new Error(`subagents.maxConcurrency must be a positive integer >= 1, got: ${config.maxConcurrency}`);
    }
  }
  if (config.maxSteps !== undefined) {
    if (!Number.isInteger(config.maxSteps) || config.maxSteps < 1) {
      throw new Error(`subagents.maxSteps must be a positive integer >= 1, got: ${config.maxSteps}`);
    }
  }
  if (config.allowNested !== undefined && typeof config.allowNested !== 'boolean') {
    throw new Error(`subagents.allowNested must be a boolean (true/false), got: ${typeof config.allowNested} (${config.allowNested})`);
  }
};

export const resolveSubagentsConfig = (candidate: Partial<SubagentsConfig>): SubagentsConfig => {
  validateSubagentsConfig(candidate);
  return {
    enabled: candidate.enabled ?? DEFAULT_SUBAGENTS_CONFIG.enabled,
    maxConcurrency: candidate.maxConcurrency ?? DEFAULT_SUBAGENTS_CONFIG.maxConcurrency,
    maxSteps: candidate.maxSteps ?? DEFAULT_SUBAGENTS_CONFIG.maxSteps,
    allowNested: candidate.allowNested ?? DEFAULT_SUBAGENTS_CONFIG.allowNested,
  };
};

export type SubagentAccess = 'read-only' | 'write';

export interface DelegatedTaskSpec {
  task: string;
  access: SubagentAccess;
  maxSteps?: number;
}

export type ChildRunStatus = 'completed' | 'failed' | 'interrupted';

export interface ChildRunOutcome {
  status: ChildRunStatus;
  text?: string;
  error?: string;
  usageSummary?: UsageSummary;
}

export interface ChildRunRequest {
  task: string;
  access: SubagentAccess;
  maxSteps?: number;
  signal: AbortSignal;
}

export type ChildRunner = (request: ChildRunRequest) => Promise<ChildRunOutcome>;

export interface ChildTaskResult extends DelegatedTaskSpec {
  index: number;
  status: ChildRunStatus;
  text?: string;
  error?: string;
  usageSummary?: UsageSummary;
}

/**
 * Registry containing only workspace-inspection tools. Used for read-only
 * children so read-only access is enforced by tool availability, not by
 * prompt instructions. File mutation, shell, quality-check, fetch, todo,
 * openspec, and delegation tools are all omitted.
 */
export const createReadOnlyRegistry = (env: ToolEnvironment): ToolRegistry => {
  const registry = new ToolRegistry();
  registry.register(createReadTool(env));
  registry.register(createGlobTool(env));
  registry.register(createGrepTool(env));
  return registry;
};

/**
 * Wrap a Permissions instance so that concurrent children cannot interleave
 * interactive approval prompts on the shared terminal. All approve() calls
 * are chained through a single promise queue; rule-based and auto-approve
 * decisions still resolve immediately once their turn arrives.
 */
export const serializeApprovals = (permissions: Permissions): Permissions => {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    ...permissions,
    approve: (tool, args) => {
      const result = chain.then(() => permissions.approve(tool, args));
      chain = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
};

export const parseDelegatedTasks = (value: unknown): DelegatedTaskSpec[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('delegate requires a non-empty "tasks" array.');
  }
  if (value.length > MAX_DELEGATED_TASKS) {
    throw new Error(`delegate accepts at most ${MAX_DELEGATED_TASKS} tasks per call, got ${value.length}.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`tasks[${index}] must be an object with "task" and "access".`);
    }
    const spec = entry as Record<string, unknown>;
    if (typeof spec.task !== 'string' || spec.task.trim().length === 0) {
      throw new Error(`tasks[${index}].task must be a non-empty string.`);
    }
    if (spec.access !== 'read-only' && spec.access !== 'write') {
      throw new Error(`tasks[${index}].access must be "read-only" or "write".`);
    }
    if (spec.maxSteps !== undefined) {
      if (!Number.isInteger(spec.maxSteps) || (spec.maxSteps as number) < 1) {
        throw new Error(`tasks[${index}].maxSteps must be a positive integer >= 1.`);
      }
    }
    return {
      task: spec.task,
      access: spec.access,
      maxSteps: spec.maxSteps as number | undefined,
    };
  });
};

export interface DelegateBatchOptions {
  concurrency: number;
  runChild: ChildRunner;
  signal?: AbortSignal;
  onEvent?: (
    phase: SubagentPhase,
    result: Omit<ChildTaskResult, 'status'> & { status?: ChildRunStatus },
  ) => Promise<void> | void;
}

/**
 * Run delegated tasks with a bounded number of concurrent children.
 * Parent cancellation is propagated to every running child; tasks that never
 * started are reported as interrupted.
 */
export const runDelegatedBatch = async (
  specs: DelegatedTaskSpec[],
  options: DelegateBatchOptions,
): Promise<ChildTaskResult[]> => {
  const results: (ChildTaskResult | undefined)[] = Array.from({ length: specs.length });
  const controllers = new Set<AbortController>();
  const abortChildren = () => {
    for (const controller of controllers) controller.abort();
  };
  if (options.signal) {
    if (options.signal.aborted) abortChildren();
    else options.signal.addEventListener('abort', abortChildren, { once: true });
  }

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(options.concurrency, specs.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < specs.length) {
      if (options.signal?.aborted) break;
      const index = nextIndex;
      nextIndex += 1;
      const spec = specs[index];
      const controller = new AbortController();
      controllers.add(controller);
      const abortChild = () => controller.abort();
      if (options.signal?.aborted) controller.abort();
      else options.signal?.addEventListener('abort', abortChild, { once: true });

      const base = { index, task: spec.task, access: spec.access, maxSteps: spec.maxSteps };
      await options.onEvent?.(SubagentPhase.Start, base);
      try {
        const outcome = await options.runChild({
          task: spec.task,
          access: spec.access,
          maxSteps: spec.maxSteps,
          signal: controller.signal,
        });
        const result: ChildTaskResult = {
          ...base,
          status: outcome.status,
          text: outcome.text,
          error: outcome.error,
          usageSummary: outcome.usageSummary,
        };
        results[index] = result;
        await options.onEvent?.(SubagentPhase.Finish, result);
      } catch (error) {
        const aborted = controller.signal.aborted || options.signal?.aborted === true;
        const result: ChildTaskResult = {
          ...base,
          status: aborted ? 'interrupted' : 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
        results[index] = result;
        await options.onEvent?.(SubagentPhase.Finish, result);
      } finally {
        controllers.delete(controller);
        options.signal?.removeEventListener('abort', abortChild);
      }
    }
  });

  try {
    await Promise.all(workers);
  } finally {
    options.signal?.removeEventListener('abort', abortChildren);
  }

  return results.map((result, index) => {
    if (result) return result;
    const spec = specs[index];
    return {
      index,
      task: spec.task,
      access: spec.access,
      maxSteps: spec.maxSteps,
      status: 'interrupted' as const,
      error: 'Parent task was cancelled before this subtask started.',
    };
  });
};

export interface DelegateToolDeps {
  config: SubagentsConfig;
  runChild: ChildRunner;
  emit: (type: AgentEvent['type'], data?: Record<string, unknown>) => Promise<void> | void;
  signal?: AbortSignal;
}

export const delegateDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'delegate',
    description:
      'Delegate one or more independent bounded subtasks to child agents. Each child runs with fresh conversation state in the same workspace. Every task must declare access: "read-only" (inspection only, no file/shell tools) or "write" (full tools, subject to permissions). Results are returned per task with status, output, and usage.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: `Array of 1-${MAX_DELEGATED_TASKS} independent subtasks. Only batch tasks that do not depend on each other's edits; concurrent write tasks share the same workspace.`,
          items: {
            type: 'object',
            properties: {
              task: { type: 'string', description: 'Self-contained description of the subtask.' },
              access: { type: 'string', enum: ['read-only', 'write'], description: 'Required permission mode for this subtask.' },
              maxSteps: { type: 'number', description: 'Optional per-child step limit override.' },
            },
            required: ['task', 'access'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

export const createDelegateTool = (deps: DelegateToolDeps): Tool<Record<string, unknown>, ChildTaskResult[]> => {
  return {
    needsApproval: false,
    trust: TrustKind.ALWAYS,
    describe: (args) => {
      const count = Array.isArray(args?.tasks) ? args.tasks.length : 0;
      return `delegate ${count} subtask(s) to child agents`;
    },
    execute: async (args) => {
      if (!deps.config.enabled) {
        throw new Error('Subagent delegation is disabled. Enable it via the subagents.enabled configuration option.');
      }
      const specs = parseDelegatedTasks(args.tasks);
      return runDelegatedBatch(specs, {
        concurrency: deps.config.maxConcurrency,
        signal: deps.signal,
        runChild: deps.runChild,
        onEvent: async (phase, result) => {
          await deps.emit('subagent', {
            phase,
            index: result.index,
            total: specs.length,
            task: result.task,
            access: result.access,
            status: result.status,
            error: result.error,
          });
        },
      });
    },
    definition: delegateDefinition,
  };
};
