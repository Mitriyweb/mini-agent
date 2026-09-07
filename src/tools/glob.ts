import path from 'node:path';
import { globToRegExp, matchGlob } from '../utils/globmatch.js';
import { truncateOutput } from '../utils/textfile.js';
import { walkFiles } from '../utils/walk.js';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.js';

const MAX_MATCHES = 200;

export interface GlobArgs {
  pattern: string;
  path?: string;
}

export const globDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'glob',
    description: 'Find workspace files matching a glob wildcard pattern (e.g., **/*.ts).',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match against relative file paths.',
        },
        path: {
          type: 'string',
          description: 'Subdirectory relative to workspace root to search from.',
        },
      },
      required: ['pattern'],
    },
  },
};

export const createGlobTool = (env: ToolEnvironment): Tool<GlobArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: false,
    trust: TrustKind.PATH,
    describe: (args) => `glob ${args.pattern}`,
    async execute(args) {
      const rawPattern = args.pattern;
      const pattern = typeof rawPattern === 'string' ? rawPattern.trim() || '**' : '';
      if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new Error('pattern must be a non-empty string.');
      }
      globToRegExp(pattern);

      const target = await workspace.resolveExistingPath(args.path ?? '.');
      if (!target.isDirectory) {
        throw new Error(`glob path must be a directory: ${args.path ?? '.'}`);
      }

      const fromRoot = path.relative(workspace.root, target.path);
      const baseRel = fromRoot.replaceAll('\\', '/') || '';
      const matches: string[] = [];
      let extra = 0;

      await walkFiles(target.path, baseRel, async (_absPath, relPath) => {
        if (!matchGlob(relPath, pattern)) return false;
        if (matches.length < MAX_MATCHES) {
          matches.push(relPath);
          return false;
        }
        extra += 1;
        return false;
      });

      if (matches.length === 0 && extra === 0) return 'No files matched.';
      const lines = [...matches];
      if (extra > 0) lines.push(`... ${extra} more`);
      return truncateOutput(lines.join('\n'));
    },
    definition: globDefinition,
  };
};
