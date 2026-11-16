import type { Tool } from './tools.ts';

export enum PermissionEffect {
  ALLOW = 'allow',
  DENY = 'deny',
}

export enum PermissionMatchKind {
  EXACT = 'exact',
  GLOB = 'glob',
}

export enum PermissionScope {
  SESSION = 'session',
  PERSISTENT = 'persistent',
}

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

export enum PermissionMode {
  NORMAL = 'normal',
  BYPASS = 'bypass',
}

export enum PermissionDecisionKind {
  ALLOW_ONCE = 'allow-once',
  ALLOW_SESSION = 'allow-session',
  ALLOW_PERSISTENT = 'allow-persistent',
  BYPASS = 'bypass',
  DENY = 'deny',
}

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
  /** Effective permission mode. 'bypass' auto-approves prompts while deny rules and trust-root containment still apply. */
  permissionMode?: PermissionMode;
  /** Called when the mode changes mid-session (approval-prompt bypass option or setPermissionMode). */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  ask?: (description: string) => Promise<boolean> | boolean;
  askDecision?: AskDecisionCallback;
  rl?: import('node:readline/promises').Interface | null;
  configPath?: string;
  manager?: any; // PermissionManager instance
  globalConfigPath?: string;
}

export interface Permissions {
  approve: (tool: Tool, args: any) => Promise<boolean>;
  setAutoApprove: (enabled: boolean) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  getPermissionMode: () => PermissionMode;
  close: () => void;
  getManager?: () => any;
}
