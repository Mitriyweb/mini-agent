import { formatNumberedLines, readTextFile } from '../utils/textfile.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';

const MAX_LIMIT = 2000;

export interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}

const resolveOffset = (value?: number): number => {
  const offset = Math.trunc(value ?? 1);
  if (!Number.isFinite(offset) || offset < 1) {
    throw new Error('offset must be a 1-based line number.');
  }
  return offset;
};

const resolveLimit = (value: number | undefined, remaining: number): number => {
  if (value === undefined || value === null) return remaining;
  const limit = Math.trunc(value);
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error('limit must be a positive number.');
  }
  return limit;
};

export const readDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read',
    description: 'Read a UTF-8 text file from the project workspace. Optional offset/limit return numbered line slices for large files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root.',
        },
        offset: {
          type: 'number',
          description: '1-based start line. Default 1.',
        },
        limit: {
          type: 'number',
          description: 'Max lines to return. Default remaining lines, hard cap 2000.',
        },
      },
      required: ['path'],
    },
  },
};

export const createReadTool = (env: ToolEnvironment): Tool<ReadArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: false,
    trust: TrustKind.PATH,
    describe: (args) => `read ${args.path}`,
    execute: async (args) => {
      const relativePath = args.path;
      const offset = resolveOffset(args.offset);
      const filePath = await workspace.resolveExistingFile(relativePath);
      const content = await readTextFile(filePath);
      const lines = content.length === 0 ? [] : content.split('\n');
      const totalLines = lines.length;
      if (totalLines === 0) return '(empty file)';
      const remaining = Math.max(0, totalLines - offset + 1);
      const requested = resolveLimit(args.limit, remaining);
      const limit = Math.min(requested, MAX_LIMIT, remaining);
      const start = offset - 1;
      const slice = lines.slice(start, start + limit);
      return formatNumberedLines(slice, offset, totalLines);
    },
    definition: readDefinition,
  };
};
