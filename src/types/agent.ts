import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type { Permissions, PermissionMode } from './permissions.ts';
import type { Provider, CustomProviderConfig } from './llm.ts';
import type { Workspace } from '../agent/workspace.ts';
import type { Workflow, Skill } from '../agent/customizations.ts';
import type { LogLevel, LoggingConfig, Logger, AuditConfig } from '../agent/logging.ts';
import type { CostTrackingConfig, UsageTracker, UsageSummary } from '../agent/usage-tracker.ts';
import type { SkillsConfig } from '../agent/skills.ts';
import type { SystemPromptConfig } from '../agent/system-prompt.ts';
import type { DurableRun } from '../agent/run-state.ts';
import type { QualityGateResult, QualityGatesConfig } from '../agent/quality-gates.ts';
import type { ReviewConfig } from '../agent/review-orchestrator.ts';
import type { SubagentsConfig } from '../agent/subagents.ts';
import { ReviewResultStatus, ReviewVerdict } from '../agent/review-types.ts';

export enum AgentResultStatus {
  OK = 'ok',
  ERROR = 'error',
  DENIED = 'denied',
}

export enum SubagentPhase {
  Start = 'start',
  Finish = 'finish',
}

export interface StepEvent {
  type: 'step';
  step: number;
  maxSteps: number;
  model: string;
}

export interface ToolEvent {
  type: 'tool';
  name: string;
  args: unknown;
  argsText: string;
}

export interface ResultEvent {
  type: 'result';
  name: string;
  args: unknown;
  status: AgentResultStatus;
  preview: string;
}

export interface AssistantEvent {
  type: 'assistant';
  text: string;
}

export interface QualityGatesEvent {
  type: 'quality-gates';
  results: QualityGateResult[];
}

export interface ReviewStartEvent {
  type: 'review-start';
  runId: string;
}

export interface ReviewCompleteEvent {
  type: 'review-complete';
  verdict: string;
  findings: string;
}

export interface SubagentEvent {
  type: 'subagent';
  phase: SubagentPhase;
  index: number;
  total: number;
  task: string;
  access?: string;
  status?: string;
  error?: string;
}

export type AgentEvent =
  | StepEvent
  | ToolEvent
  | ResultEvent
  | AssistantEvent
  | QualityGatesEvent
  | ReviewStartEvent
  | ReviewCompleteEvent
  | SubagentEvent;

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
  /** Audit trail settings. Independent of `logging.level`; defaults to enabled. */
  audit?: AuditConfig;
  costTracking?: CostTrackingConfig | boolean;
  skillsConfig?: SkillsConfig;
  systemPromptConfig?: SystemPromptConfig;
  logger?: Logger;
  usageTracker?: UsageTracker;
  durableRun?: DurableRun;
  qualityGates?: QualityGatesConfig;
  review?: ReviewConfig;
  signal?: AbortSignal;
  /** Subagent delegation configuration. Disabled by default. */
  subagents?: SubagentsConfig;
  /** Internal: delegation depth of this run (0 for top-level agents). */
  subagentDepth?: number;
  /** Internal: restrict this run to the read-only inspection tool registry. */
  forceReadOnlyTools?: boolean;
  /** User-declared custom providers from config, forwarded to provider resolution. */
  customProviders?: Record<string, CustomProviderConfig>;
  /** Effective permission mode for this run. Falls back to permissions.getPermissionMode() when the Permissions implementation exposes it. */
  permissionMode?: PermissionMode;
}

export interface AgentResult {
  text: string;
  messages: ChatCompletionMessageParam[];
  usageSummary?: UsageSummary;
  usageTracker?: UsageTracker;
  qualityGateResults?: QualityGateResult[];
  reviewOutcome?: {
    verdict: ReviewVerdict;
    findings: string;
    status?: ReviewResultStatus;
  };
}
