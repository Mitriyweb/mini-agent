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

export interface PermissionsOptions {
  autoApprove?: boolean;
  ask?: (description: string) => Promise<boolean> | boolean;
  rl?: import('node:readline/promises').Interface | null;
  configPath?: string;
  manager?: any; // PermissionManager instance
}

export interface Permissions {
  approve: (tool: Tool, args: any) => Promise<boolean>;
  close: () => void;
  getManager?: () => any;
}
