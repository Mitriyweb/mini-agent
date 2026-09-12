import type { Workspace } from '../agent/workspace.ts';

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

export interface ToolEnvironment {
  workspace: Workspace;
}

export interface Tool<TArgs = any, TResult = unknown> {
  needsApproval?: boolean;
  trust?: TrustKind | ((args: TArgs) => TrustKind);
  describe?: (args: TArgs) => string;
  execute: (args: TArgs) => Promise<TResult> | TResult;
  definition: ToolDefinition;
}
