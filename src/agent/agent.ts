import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { INSTRUCTIONS } from './instructions.ts';
import { formatCustomizationsPrompt } from './customizations.ts';
import { Workspace } from './workspace.ts';
import { createBashTool } from '../tools/bash.ts';
import { createCheckTool } from '../tools/check.ts';
import { createDeleteTool } from '../tools/delete.ts';
import { createEditTool } from '../tools/edit.ts';
import { createFetchTool } from '../tools/fetch.ts';
import { createGlobTool } from '../tools/glob.ts';
import { createGrepTool } from '../tools/grep.ts';
import { createPatchTool } from '../tools/patch.ts';
import { createReadTool } from '../tools/read.ts';
import { createTodoTool } from '../tools/todo.ts';
import { createOpenspecTool } from '../tools/openspec.ts';
import { createWriteTool } from '../tools/write.ts';
import { ToolRegistry } from '../tools/registry.ts';
import { AgentResultStatus, type AgentEvent, type AgentOptions, type AgentResult } from '../types/agent.ts';
import type { ToolEnvironment } from '../types/tools.ts';
import { Logger, type LogLevel, type LoggingConfig } from './logging.ts';
import { UsageTracker, type CostTrackingConfig } from './usage-tracker.ts';
import { filterSkills } from './skills.ts';
import { resolveSystemPrompt } from './system-prompt.ts';

const MAX_RESULT_CHARS = 60_000;
const LOG_RESULT_CHARS = 4_000;
const EMPTY_REPLY = '(Agent finished without a text response.)';

export const errorText = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return '';
  return `${error}`;
};

export const renderToolResult = (value: unknown, maxChars = MAX_RESULT_CHARS): string => {
  const isText = typeof value === 'string';
  const serialized = isText ? (value as string) : JSON.stringify(value, null, 2);
  if (serialized.length <= maxChars) return serialized;
  const truncated = serialized.slice(0, maxChars);
  return `${truncated}\n...[tool result truncated by harness]`;
};

export const partText = (part: any): string => {
  if (typeof part === 'string') return part;
  return part?.text ?? '';
};

export const messageText = (message: any): string => {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = content.map(partText);
  return parts.join('');
};

export const resultStatus = (rendered: string): AgentResultStatus => {
  if (rendered.startsWith('ERROR:')) return AgentResultStatus.ERROR;
  if (rendered.startsWith('DENIED:')) return AgentResultStatus.DENIED;
  return AgentResultStatus.OK;
};

export const parseToolArgs = (argsText: string): Record<string, any> | null => {
  try {
    const args = JSON.parse(argsText);
    if (typeof args === 'object' && args !== null && !Array.isArray(args)) {
      return args;
    }
    return null;
  } catch {
    return null;
  }
};

export const createBuiltInRegistry = (env: ToolEnvironment): ToolRegistry => {
  const registry = new ToolRegistry();
  registry.register(createReadTool(env));
  registry.register(createWriteTool(env));
  registry.register(createEditTool(env));
  registry.register(createPatchTool(env));
  registry.register(createDeleteTool(env));
  registry.register(createGlobTool(env));
  registry.register(createGrepTool(env));
  registry.register(createBashTool(env));
  registry.register(createCheckTool(env));
  registry.register(createFetchTool());
  registry.register(createTodoTool());
  registry.register(createOpenspecTool(env));
  return registry;
};

export interface ToolCallContext {
  permissions: any;
  emit: (type: AgentEvent['type'], data?: Record<string, any>) => Promise<void>;
  registry: ToolRegistry;
  logger: Logger;
}

export const runToolCall = async (
  call: any,
  context: ToolCallContext,
): Promise<ChatCompletionMessageParam> => {
  const name = call.function?.name;
  const argsText = call.function?.arguments ?? '{}';
  const tool = context.registry.get(name);
  const args = parseToolArgs(argsText);

  await context.emit('tool', { name, args, argsText });

  let result: unknown;
  try {
    if (!tool) throw new Error(`Unknown tool requested: ${name}`);
    if (!args) throw new Error('Invalid tool arguments.');
    const approved = await context.permissions.approve(tool, args);
    if (!approved) result = 'DENIED: User did not approve this tool call.';
    else result = await tool.execute(args);
  } catch (error) {
    result = `ERROR: ${errorText(error)}`;
  }

  const rendered = renderToolResult(result);
  const preview = rendered.slice(0, LOG_RESULT_CHARS);
  const status = resultStatus(rendered);
  await context.emit('result', { name, args, status, preview });

  return {
    role: 'tool',
    content: rendered,
    tool_call_id: call.id,
  };
};

export const initialMessages = (
  task: string,
  instructions: string,
  priorMessages?: ChatCompletionMessageParam[] | null,
): ChatCompletionMessageParam[] => {
  if (priorMessages && priorMessages.length > 0) {
    return [...priorMessages, { role: 'user', content: task }];
  }
  const messages: ChatCompletionMessageParam[] = [];
  if (instructions.trim().length > 0) {
    messages.push({ role: 'system', content: instructions });
  }
  messages.push({ role: 'user', content: task });
  return messages;
};

export const runAgent = async (options: AgentOptions): Promise<AgentResult> => {
  const { task, provider, permissions, workspace } = options;
  const { maxSteps = 30, workflows = [], skills = [] } = options;
  const { onEvent, priorMessages } = options;

  // Initialize Logger
  const logger =
    options.logger ??
    (options.logging instanceof Logger
      ? options.logging
      : typeof options.logging === 'string'
        ? new Logger({ level: options.logging as LogLevel })
        : new Logger({ level: options.logging?.level }));

  // Initialize UsageTracker
  const usageTracker =
    options.usageTracker ??
    (options.costTracking instanceof UsageTracker
      ? options.costTracking
      : typeof options.costTracking === 'boolean'
        ? new UsageTracker({ enabled: options.costTracking })
        : new UsageTracker(options.costTracking));

  // Handle Skills configuration
  const skillsConfig = options.skillsConfig ?? { enabled: true };
  const filteredSkills = filterSkills(skills, skillsConfig);

  logger.logVerbose('Skills resolution:', {
    config: skillsConfig,
    availableSkills: skills.map((s) => s.name),
    activeSkills: filteredSkills.map((s) => s.name),
  });

  // Handle System Prompt configuration
  let baseInstructions = '';
  if (options.systemPromptConfig) {
    baseInstructions = await resolveSystemPrompt(options.systemPromptConfig, workspace.root);
  } else if (options.instructions !== undefined) {
    baseInstructions = options.instructions;
  } else {
    baseInstructions = await resolveSystemPrompt({ enabled: true }, workspace.root);
  }

  const customizationsPrompt = formatCustomizationsPrompt({ workflows, skills: filteredSkills });
  const effectiveInstructions = [baseInstructions.trim(), customizationsPrompt.trim()]
    .filter(Boolean)
    .join('\n\n');

  logger.logVerbose('Effective System Instructions:', effectiveInstructions);

  const emit = async (type: AgentEvent['type'], data = {}) => {
    await onEvent?.({ type, ...data } as AgentEvent);
  };

  const messages = initialMessages(task, effectiveInstructions, priorMessages);
  const registry = createBuiltInRegistry({ workspace });
  const toolContext: ToolCallContext = { permissions, emit, registry, logger };

  for (let step = 1; step <= maxSteps; step += 1) {
    const model = provider.model;
    await emit('step', { step, maxSteps, model });

    const tools = registry.definitions();

    logger.logVerbose(`LLM Request Start [Step ${step}/${maxSteps}]`, {
      model,
      messageCount: messages.length,
      toolsCount: tools.length,
      lastMessage: messages[messages.length - 1],
    });

    const startTime = Date.now();
    let response: any;
    try {
      response = await provider.respond({ messages, tools });
    } catch (err) {
      logger.logError(`LLM Request failed at step ${step}`, err);
      throw err;
    }
    const durationMs = Date.now() - startTime;

    const usageRecord = usageTracker.recordRequest(model, response?.usage, durationMs);

    logger.logVerbose(`LLM Request End [Step ${step}/${maxSteps}]`, {
      durationMs,
      usage: usageRecord,
      responseChoiceCount: response.choices?.length,
    });

    const message = response.choices?.[0]?.message;
    if (!message) throw new Error('Model returned no message.');

    messages.push(message);

    const text = messageText(message);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const finalText = text || EMPTY_REPLY;
      await emit('assistant', { text: finalText });
      return {
        text: finalText,
        messages,
        usageSummary: usageTracker.getSummary(),
        usageTracker,
      };
    }
    if (text) await emit('assistant', { text });

    for (const call of calls) {
      const output = await runToolCall(call, toolContext);
      messages.push(output);
    }
  }

  throw new Error(`Agent exceeded the maximum of ${maxSteps} steps.`);
};
