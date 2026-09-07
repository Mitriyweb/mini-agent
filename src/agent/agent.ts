import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { INSTRUCTIONS } from './instructions.js';
import { formatCustomizationsPrompt } from './customizations.js';
import { Workspace } from './workspace.js';
import { createBashTool } from '../tools/bash.js';
import { createCheckTool } from '../tools/check.js';
import { createDeleteTool } from '../tools/delete.js';
import { createEditTool } from '../tools/edit.js';
import { createFetchTool } from '../tools/fetch.js';
import { createGlobTool } from '../tools/glob.js';
import { createGrepTool } from '../tools/grep.js';
import { createPatchTool } from '../tools/patch.js';
import { createReadTool } from '../tools/read.js';
import { createTodoTool } from '../tools/todo.js';
import { createOpenspecTool } from '../tools/openspec.js';
import { createWriteTool } from '../tools/write.js';
import { ToolRegistry } from '../tools/registry.js';
import type { AgentEvent, AgentOptions, AgentResult } from '../types/agent.js';
import type { ToolEnvironment } from '../types/tools.js';

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

export const resultStatus = (rendered: string): 'ok' | 'error' | 'denied' => {
  if (rendered.startsWith('ERROR:')) return 'error';
  if (rendered.startsWith('DENIED:')) return 'denied';
  return 'ok';
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
  return [
    { role: 'system', content: instructions },
    { role: 'user', content: task },
  ];
};

export const runAgent = async (options: AgentOptions): Promise<AgentResult> => {
  const { task, provider, permissions, workspace } = options;
  const { maxSteps = 30, instructions = INSTRUCTIONS, workflows = [], skills = [] } = options;
  const { onEvent, priorMessages } = options;
  const effectiveInstructions = `${instructions}${formatCustomizationsPrompt({ workflows, skills })}`;

  const emit = async (type: AgentEvent['type'], data = {}) => {
    await onEvent?.({ type, ...data } as AgentEvent);
  };

  const messages = initialMessages(task, effectiveInstructions, priorMessages);
  const registry = createBuiltInRegistry({ workspace });
  const toolContext: ToolCallContext = { permissions, emit, registry };

  for (let step = 1; step <= maxSteps; step += 1) {
    const model = provider.model;
    await emit('step', { step, maxSteps, model });

    const tools = registry.definitions();
    const response = await provider.respond({ messages, tools });
    const message = response.choices?.[0]?.message;
    if (!message) throw new Error('Model returned no message.');

    messages.push(message);

    const text = messageText(message);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      const finalText = text || EMPTY_REPLY;
      await emit('assistant', { text: finalText });
      return { text: finalText, messages };
    }
    if (text) await emit('assistant', { text });

    for (const call of calls) {
      const output = await runToolCall(call, toolContext);
      messages.push(output);
    }
  }

  throw new Error(`Agent exceeded the maximum of ${maxSteps} steps.`);
};
