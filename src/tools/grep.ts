import path from 'node:path';
import { matchGlob } from '../utils/globmatch.js';
import { readTextFile, truncateOutput } from '../utils/textfile.js';
import { walkFiles } from '../utils/walk.js';
import type { Tool, ToolDefinition, ToolEnvironment } from '../types/tools.js';

const DEFAULT_MAX = 50;
const HARD_MAX = 200;

export interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  ignore_case?: boolean;
  max_matches?: number;
}

const compilePattern = (pattern: string, ignoreCase?: boolean): RegExp => {
  try {
    return new RegExp(pattern, ignoreCase ? 'i' : '');
  } catch (error: any) {
    throw new Error(`Invalid regex pattern: ${error.message}`);
  }
};

const resolveMaxMatches = (value?: number): number => {
  if (value === undefined || value === null) return DEFAULT_MAX;
  const max = Math.trunc(value);
  if (!Number.isFinite(max) || max < 1) {
    throw new Error('max_matches must be a positive number.');
  }
  return Math.min(max, HARD_MAX);
};

export const grepDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'grep',
    description: 'Search workspace file contents using a regular expression.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression pattern to search for.',
        },
        path: {
          type: 'string',
          description: 'Path relative to workspace root (file or directory).',
        },
        glob: {
          type: 'string',
          description: 'Glob filter for file paths (e.g. *.ts).',
        },
        ignore_case: {
          type: 'boolean',
          description: 'Case-insensitive matching if true.',
        },
        max_matches: {
          type: 'number',
          description: 'Max matching lines to return.',
        },
      },
      required: ['pattern'],
    },
  },
};

const grepFile = async (
  absPath: string,
  relPath: string,
  regex: RegExp,
  lines: string[],
  maxMatches: number,
): Promise<boolean> => {
  let content: string;
  try {
    content = await readTextFile(absPath);
  } catch {
    // ignore unreadable or binary files
    return false;
  }
  const fileLines = content.split('\n');
  for (let index = 0; index < fileLines.length; index += 1) {
    const line = fileLines[index];
    if (!regex.test(line)) continue;
    const lineNo = index + 1;
    lines.push(`${relPath}:${lineNo}:${line}`);
    if (lines.length >= maxMatches) return true;
  }
  return false;
};

export const createGrepTool = (env: ToolEnvironment): Tool<GrepArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: false,
    trust: 'path',
    describe: (args) => `grep ${args.pattern}`,
    async execute(args) {
      const pattern = args.pattern;
      if (typeof pattern !== 'string' || pattern.length === 0) {
        throw new Error('pattern must be a non-empty string.');
      }
      const ignoreCase = args.ignore_case === true;
      const regex = compilePattern(pattern, ignoreCase);
      const maxMatches = resolveMaxMatches(args.max_matches);
      const globFilter = args.glob;
      if (globFilter !== undefined && typeof globFilter !== 'string') {
        throw new Error('glob must be a string.');
      }

      const target = await workspace.resolveExistingPath(args.path ?? '.');
      const lines: string[] = [];
      let truncated = false;

      const consider = async (absPath: string, relPath: string): Promise<boolean> => {
        if (globFilter && !matchGlob(relPath, globFilter)) return false;
        const full = await grepFile(absPath, relPath, regex, lines, maxMatches);
        if (full) truncated = true;
        return full;
      };

      if (target.isFile) {
        const relFromRoot = path.relative(workspace.root, target.path);
        const rel = relFromRoot || path.basename(target.path);
        const posixRel = rel.replaceAll('\\', '/');
        await consider(target.path, posixRel);
      } else if (target.isDirectory) {
        const fromRoot = path.relative(workspace.root, target.path);
        const baseRel = fromRoot.replaceAll('\\', '/') || '';
        await walkFiles(target.path, baseRel, consider);
      } else {
        throw new Error(`Not a file or directory: ${args.path ?? '.'}`);
      }

      if (lines.length === 0) return 'No matches.';
      const body = lines.join('\n');
      const note = truncated ? `\n... stopped after ${maxMatches} matches` : '';
      return truncateOutput(body + note);
    },
    definition: grepDefinition,
  };
};
