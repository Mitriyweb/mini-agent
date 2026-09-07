import fs from 'node:fs/promises';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.js';

export interface DeleteArgs {
  path: string;
}

export const deleteDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'delete',
    description: 'Delete one file in the workspace. Does not remove directories. Prefer over bash rm.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root.',
        },
      },
      required: ['path'],
    },
  },
};

export const createDeleteTool = (env: ToolEnvironment): Tool<DeleteArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: true,
    trust: TrustKind.PATH,
    describe(args) {
      return `delete ${args.path}`;
    },
    async execute(args) {
      const relativePath = args.path;
      const filePath = await workspace.resolveExistingFile(relativePath);
      const stat = await fs.lstat(filePath);
      if (stat.isDirectory()) {
        throw new Error(`Path is a directory (not deleted): ${relativePath}`);
      }
      if (!stat.isFile()) {
        throw new Error(`Not a regular file: ${relativePath}`);
      }
      await fs.unlink(filePath);
      return `Deleted ${relativePath}.`;
    },
    definition: deleteDefinition,
  };
};
