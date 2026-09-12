import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Permissions } from './permissions.ts';
import type { Provider } from './llm.ts';
import type { Workspace } from '../agent/workspace.ts';
import type { Workflow, Skill } from '../agent/customizations.ts';
import type { LogLevel, LoggingConfig, Logger } from '../agent/logging.ts';
import type { CostTrackingConfig, UsageTracker, UsageSummary } from '../agent/usage-tracker.ts';
import type { SkillsConfig } from '../agent/skills.ts';
import type { SystemPromptConfig } from '../agent/system-prompt.ts';

export enum AgentResultStatus {
  OK = 'ok',
  ERROR = 'error',
  DENIED = 'denied',
}

export type AgentEvent =
  | { type: 'step'; step: number; maxSteps: number; model: string }
  | { type: 'tool'; name: string; args: unknown; argsText: string }
  | { type: 'result'; name: string; args: unknown; status: AgentResultStatus; preview: string }
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

  // Configurable options
  logging?: LoggingConfig | LogLevel;
  costTracking?: CostTrackingConfig | boolean;
  skillsConfig?: SkillsConfig;
  systemPromptConfig?: SystemPromptConfig;
  logger?: Logger;
  usageTracker?: UsageTracker;
}

export interface AgentResult {
  text: string;
  messages: ChatCompletionMessageParam[];
  usageSummary?: UsageSummary;
  usageTracker?: UsageTracker;
}
