import type { Tool } from './tools.js';

export type PermissionEffect = 'allow' | 'deny';
export type PermissionMatchKind = 'exact' | 'glob';
export type PermissionScope = 'session' | 'persistent';

export interface PermissionRule {
  id?: string;
  effect: PermissionEffect;
  pattern: string;
  match: PermissionMatchKind;
  scope?: PermissionScope;
  createdAt?: number;
}

export interface PermissionConfig {
  version: number;
  rules: PermissionRule[];
}

export type PermissionDecisionKind = 'allow-once' | 'allow-session' | 'allow-persistent' | 'deny';

export interface PermissionDecision {
  kind: PermissionDecisionKind;
  pattern?: string;
  match?: PermissionMatchKind;
}

export interface PermissionPromptContext {
  description: string;
  command?: string;
  candidates: { label: string; pattern: string; match: PermissionMatchKind }[];
}

export type AskDecisionCallback = (
  context: PermissionPromptContext
) => Promise<PermissionDecision | boolean> | PermissionDecision | boolean;

export interface PermissionsOptions {
  autoApprove?: boolean;
  ask?: (description: string) => Promise<boolean> | boolean;
  askDecision?: AskDecisionCallback;
  rl?: import('node:readline/promises').Interface | null;
  configPath?: string;
  manager?: any; // PermissionManager instance
}

export interface Permissions {
  approve: (tool: Tool, args: any) => Promise<boolean>;
  close: () => void;
  getManager?: () => any;
}
