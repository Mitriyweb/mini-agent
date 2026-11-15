import type { Workspace } from '../agent/workspace.ts';
import type { BaselineType } from '../agent/review-types.ts';

export enum TrustKind {
  PATH = 'path',
  COMMAND = 'command',
  ALWAYS = 'always',
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ReviewBundleContext {
  runId: string;
  task: string;
  baseline?: { type: BaselineType; ref?: string; timestamp: string };
}

export interface ToolEnvironment {
  workspace: Workspace;
  /** Context used to build redacted review bundles for CLI reviewer tools. */
  reviewContext?: ReviewBundleContext;
  /** Abort signal of the owning agent run, propagated to long-running tools. */
  signal?: AbortSignal;
}

export interface Tool<TArgs = any, TResult = unknown> {
  needsApproval?: boolean;
  trust?: TrustKind | ((args: TArgs) => TrustKind);
  describe?: (args: TArgs) => string;
  execute: (args: TArgs) => Promise<TResult> | TResult;
  definition: ToolDefinition;
}
