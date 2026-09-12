import fs from 'node:fs/promises';
import path from 'node:path';
import { runFile } from '../utils/command.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';

export interface CheckArgs {
  path?: string;
}

const hasPath = (args: CheckArgs): boolean => typeof args.path === 'string' && args.path.length > 0;

export const checkDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'check',
    description: 'Run syntax/type checks (bun x tsc --noEmit or project check script).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional file path relative to workspace root to run type checks on.',
        },
      },
    },
  },
};

export const createCheckTool = (env: ToolEnvironment): Tool<CheckArgs, string> => {
  const { workspace } = env;

  const hasCheckScript = async (): Promise<boolean> => {
    const pkgPath = path.join(workspace.root, 'package.tson');
    try {
      const raw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      return typeof pkg?.scripts?.check === 'string';
    } catch {
      return false;
    }
  };

  return {
    needsApproval: true,
    trust: (args) => (hasPath(args) ? TrustKind.PATH : TrustKind.COMMAND),
    describe(args) {
      if (hasPath(args)) return `check ${args.path}`;
      return 'bun run check';
    },
    async execute(args) {
      if (hasPath(args) && args.path) {
        const filePath = await workspace.resolveExistingFile(args.path);
        if (filePath.endsWith('.ts') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
          return runFile('node', ['--check', filePath], workspace.root);
        }
        return runFile('bun', ['x', 'tsc', '--noEmit', filePath], workspace.root);
      }
      const ok = await hasCheckScript();
      if (!ok) {
        return runFile('bun', ['x', 'tsc', '--noEmit'], workspace.root);
      }
      return runFile('bun', ['run', 'check'], workspace.root);
    },
    definition: checkDefinition,
  };
};
