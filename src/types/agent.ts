import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Permissions } from './permissions.js';
import type { Provider } from './llm.js';
import type { Workspace } from '../agent/workspace.js';
import type { Workflow, Skill } from '../agent/customizations.js';

export type AgentEvent =
  | { type: 'step'; step: number; maxSteps: number; model: string }
  | { type: 'tool'; name: string; args: unknown; argsText: string }
  | { type: 'result'; name: string; args: unknown; status: 'ok' | 'error' | 'denied'; preview: string }
  | { type: 'assistant'; text: string };

export interface AgentOptions {
  task: string;
  provider: Provider;
  permissions: Permissions;
  workspace: Workspace;
  maxSteps?: number;
  instructions?: string;
  onEvent?: (event: AgentEvent) => Promise<void> | void;
  priorMessages?: ChatCompletionMessageParam[] | null;
  workflows?: Workflow[];
  skills?: Skill[];
}

export interface AgentResult {
  text: string;
  messages: ChatCompletionMessageParam[];
}
