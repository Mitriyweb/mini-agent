import type { Tool } from './tools.js';

export interface PermissionsOptions {
  autoApprove?: boolean;
  ask?: (description: string) => Promise<boolean> | boolean;
  rl?: import('node:readline/promises').Interface | null;
}

export interface Permissions {
  approve: (tool: Tool, args: any) => Promise<boolean>;
  close: () => void;
}
