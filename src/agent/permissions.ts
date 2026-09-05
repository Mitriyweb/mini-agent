import os from 'node:os';
import path from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import concolor from 'concolor';
import { isInside, Workspace } from './workspace.js';
import type { Tool } from '../types/tools.js';
import type { Permissions, PermissionsOptions } from '../types/permissions.js';

const color = (concolor as any)({
  warn: 'b,yellow',
});

const PATH_TOKEN_RE = /"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s;|&<>()]+)/g;
const APPROVE_ANSWERS = ['y', 'yes'];

export const extractPathTokens = (command: string): string[] => {
  const tokens: string[] = [];
  PATH_TOKEN_RE.lastIndex = 0;
  let match = PATH_TOKEN_RE.exec(command);
  while (match) {
    const token = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (token) tokens.push(token);
    match = PATH_TOKEN_RE.exec(command);
  }
  return tokens;
};

export const looksLikePath = (token: string): boolean => {
  if (!token || token.includes('://')) return false;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('~')) return true;
  if (token.startsWith('/') || token.startsWith('./')) return true;
  if (token.startsWith('../')) return true;
  return token.includes('/') || token.includes('\\');
};

export const unwrapPathToken = (token: string): string => {
  const eq = token.indexOf('=');
  if (eq <= 0 || eq >= token.length - 1) return token;
  const value = token.slice(eq + 1);
  if (looksLikePath(value)) return value;
  return token;
};

export const resolveAgainst = (workspaceRoot: string, token: string): string => {
  const unwrapped = unwrapPathToken(token);
  if (unwrapped === '~') return os.homedir();
  if (unwrapped.startsWith('~/') || unwrapped.startsWith('~\\')) {
    return path.join(os.homedir(), unwrapped.slice(2));
  }
  return path.resolve(workspaceRoot, unwrapped);
};

export const commandLeavesTrustRoot = (
  command: string,
  trustRoot: string,
  workspaceRoot: string,
): boolean => {
  const tokens = extractPathTokens(command);
  for (const token of tokens) {
    const candidate = unwrapPathToken(token);
    if (!looksLikePath(token) && !looksLikePath(candidate)) continue;
    const resolved = resolveAgainst(workspaceRoot, token);
    if (!isInside(trustRoot, resolved)) return true;
  }
  return false;
};

export const filePathLeavesTrustRoot = (args: any, workspace: Workspace): boolean => {
  const relativePath = args.path;
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    return !workspace.gitRoot || !isInside(workspace.gitRoot, workspace.root);
  }
  const resolved = path.resolve(workspace.root, relativePath);
  return !workspace.gitRoot || !isInside(workspace.gitRoot, resolved);
};

export const bashLeavesTrustRoot = (args: any, workspace: Workspace): boolean => {
  const command = args.command;
  if (typeof command !== 'string' || command.length === 0) return true;
  if (!workspace.gitRoot) return true;
  return commandLeavesTrustRoot(command, workspace.gitRoot, workspace.root);
};

export const toolLeavesTrustRoot = (tool: Tool, args: any, workspace: Workspace): boolean => {
  const trustRoot = workspace.gitRoot;
  if (!trustRoot) return true;
  const trustSetting = typeof tool.trust === 'function' ? tool.trust(args) : tool.trust ?? 'always';
  if (trustSetting === 'path') return filePathLeavesTrustRoot(args, workspace);
  if (trustSetting === 'command') return bashLeavesTrustRoot(args, workspace);
  return true;
};

export const createPermissions = (
  options: PermissionsOptions = {},
  workspace?: Workspace,
): Permissions => {
  const autoApprove = options.autoApprove ?? false;
  const ask = options.ask;
  let rl = options.rl ?? null;
  let ownsRl = false;

  const getRl = (): ReadlineInterface => {
    if (!rl) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      ownsRl = true;
    }
    return rl;
  };

  return {
    async approve(tool: Tool, args: any): Promise<boolean> {
      if (!tool.needsApproval || autoApprove) return true;
      if (workspace && workspace.gitRoot && !toolLeavesTrustRoot(tool, args, workspace)) {
        return true;
      }
      const description = tool.describe ? tool.describe(args) : tool.definition.function.name;
      if (typeof ask === 'function') return ask(description);
      const prompt = color.warn(`\nApprove: ${description}? [y/N] `);
      const answer = await getRl().question(prompt);
      const normalized = answer.trim().toLowerCase();
      return APPROVE_ANSWERS.includes(normalized);
    },
    close: () => {
      if (ownsRl && rl) {
        rl.close();
        rl = null;
        ownsRl = false;
      }
    },
  };
};
