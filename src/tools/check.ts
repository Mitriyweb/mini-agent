import fs from 'node:fs/promises';
import path from 'node:path';
import { runFile } from '../utils/command.js';
import type { Tool, ToolDefinition, ToolEnvironment } from '../types/tools.js';

export interface CheckArgs {
  path?: string;
}

const hasPath = (args: CheckArgs): boolean => typeof args.path === 'string' && args.path.length > 0;

export const checkDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'check',
    description: 'Run syntax checks (node --check on a file or npm run check for project).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Optional file path relative to workspace root to run node --check on.',
        },
      },
    },
  },
};

export const createCheckTool = (env: ToolEnvironment): Tool<CheckArgs, string> => {
  const { workspace } = env;

  const hasCheckScript = async (): Promise<boolean> => {
    const pkgPath = path.join(workspace.root, 'package.json');
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
    trust: (args) => (hasPath(args) ? 'path' : 'command'),
    describe(args) {
      if (hasPath(args)) return `check ${args.path}`;
      return 'npm run check';
    },
    async execute(args) {
      if (hasPath(args) && args.path) {
        const filePath = await workspace.resolveExistingFile(args.path);
        return runFile('node', ['--check', filePath], workspace.root);
      }
      const ok = await hasCheckScript();
      if (!ok) {
        throw new Error('No scripts.check in package.json; pass path for node --check.');
      }
      return runFile('npm', ['run', 'check'], workspace.root);
    },
    definition: checkDefinition,
  };
};
