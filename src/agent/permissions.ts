import os from 'node:os';
import path from 'node:path';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import concolor from 'concolor';
import { isInside, Workspace } from './workspace.js';
import { PermissionManager } from './permission-manager.js';
import type { Tool } from '../types/tools.js';
import type { Permissions, PermissionsOptions } from '../types/permissions.js';

const color = (concolor as any)({
  warn: 'b,yellow',
  info: 'b,blue',
  cyan: 'b,cyan',
  dim: 'gray',
});

const PATH_TOKEN_RE = /"([^"]*)"|'([^']*)'|`([^`]*)`|([^\s;|&<>()]+)/g;

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
  let autoApprove = options.autoApprove ?? false;
  const ask = options.ask;
  const askDecision = options.askDecision;
  let rl = options.rl ?? null;
  let ownsRl = false;

  const configPath =
    options.configPath ??
    (workspace?.root
      ? path.join(workspace.root, '.mini-agent', 'permissions.json')
      : path.join(os.homedir(), '.mini-agent', 'permissions.json'));
  const globalConfigPath = options.globalConfigPath ?? (workspace ? path.join(os.homedir(), '.mini-agent', 'permissions.json') : undefined);

  const manager: PermissionManager = options.manager ?? new PermissionManager({ configPath, globalConfigPath });

  const getRl = (): ReadlineInterface => {
    if (!rl || (rl as any).closed) {
      rl = createInterface({ input: process.stdin, output: process.stdout });
      ownsRl = true;
    }
    return rl;
  };

  return {
    getManager: () => manager,
    setAutoApprove: (enabled: boolean) => {
      autoApprove = enabled;
    },
    async approve(tool: Tool, args: any): Promise<boolean> {
      if (!tool.needsApproval || autoApprove) return true;
      if (workspace && workspace.gitRoot && !toolLeavesTrustRoot(tool, args, workspace)) {
        return true;
      }

      const commandTarget = typeof args?.command === 'string' ? args.command : null;
      const description = tool.describe ? tool.describe(args) : tool.definition.function.name;
      const targetStr = commandTarget || description;

      // 1. Evaluate stored permissions rules
      const evalResult = manager.evaluate(targetStr);
      if (evalResult === 'allow') return true;
      if (evalResult === 'deny') return false;

      const candidates = manager.generatePatternCandidates(targetStr);

      // 2. Custom decision callback
      if (typeof askDecision === 'function') {
        const res = await askDecision({ description, command: targetStr, candidates });
        if (typeof res === 'boolean') {
          return res;
        }
        if (res && typeof res === 'object') {
          if (res.kind === 'allow-once') return true;
          if (res.kind === 'deny') return false;

          const pattern = res.pattern || targetStr;
          const match = res.match || 'exact';
          const rule = { effect: 'allow' as const, pattern, match };

          if (res.kind === 'allow-session') {
            manager.addSessionRule(rule);
            return true;
          }
          if (res.kind === 'allow-persistent') {
            manager.addPersistentRule(rule);
            return true;
          }
        }
        return false;
      }

      // 3. Custom simple ask callback (legacy / basic test callback)
      if (typeof ask === 'function') {
        return Boolean(await ask(description));
      }

      // 4. Interactive prompt UX
      try {
        const activeRl = getRl();
        console.log(color.warn(`\nCommand requires approval:`));
        console.log(`  ${targetStr}\n`);
        console.log(`1. Allow once`);
        console.log(`2. Allow for this session`);
        console.log(`3. Allow for this project`);
        console.log(`4. Allow globally`);
        console.log(`5. Reject\n`);

        const answer = await activeRl.question(color.warn('Select an option [1-5] (default 5): '));
        const choice = answer.trim().toLowerCase();

        if (choice === '1' || choice === 'y' || choice === 'yes') {
          return true;
        }

        if (choice === '2' || choice === '3' || choice === '4') {
          const isGlobal = choice === '4';

          let selectedPattern = targetStr;
          let selectedMatch: 'exact' | 'glob' = 'exact';

          if (candidates.length > 1) {
            console.log(`\nSelect pattern to allow:`);
            candidates.forEach((cand, idx) => {
              console.log(`  ${idx + 1}. ${cand.label}`);
            });
            const patAnswer = await activeRl.question(color.warn(`Select pattern [1-${candidates.length}] (default 1): `));
            const patIdx = parseInt(patAnswer.trim(), 10) - 1;
            const chosen = (patIdx >= 0 && patIdx < candidates.length) ? candidates[patIdx] : candidates[0];
            selectedPattern = chosen.pattern;
            selectedMatch = chosen.match;
          } else if (candidates.length === 1) {
            selectedPattern = candidates[0].pattern;
            selectedMatch = candidates[0].match;
          }

          const rule = { effect: 'allow' as const, pattern: selectedPattern, match: selectedMatch };
          if (isGlobal) {
            manager.addGlobalRule(rule);
          } else if (choice === '3') {
            manager.addPersistentRule(rule);
          } else {
            manager.addSessionRule(rule);
          }

          return true;
        }
      } catch {
        return false;
      }

      return false;
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
