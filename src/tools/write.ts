import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../utils/textfile.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';

export interface WriteArgs {
  path: string;
  content: string;
}

const bytesToSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const ensureWritableDir = async (dirPath: string): Promise<void> => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error: any) {
    throw new Error(`Cannot create directory: ${dirPath}`);
  }
};

export const writeDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write',
    description: 'Create or overwrite a UTF-8 text file in the project workspace.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root.',
        },
        content: {
          type: 'string',
          description: 'Complete new file contents.',
        },
      },
      required: ['path', 'content'],
    },
  },
};

export const createWriteTool = (env: ToolEnvironment): Tool<WriteArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: true,
    trust: TrustKind.PATH,
    describe(args) {
      const relativePath = args.path;
      const content = args.content ?? '';
      const bytes = Buffer.byteLength(content, 'utf8');
      const size = bytesToSize(bytes);
      return `write ${relativePath} (${size})`;
    },
    async execute(args) {
      const relativePath = args.path;
      const content = args.content ?? '';
      const filePath = await workspace.resolveWritableFile(relativePath);
      const dirPath = path.dirname(filePath);
      await ensureWritableDir(dirPath);

      const verifiedPath = await workspace.resolveWritableFile(relativePath);
      let existed = false;
      try {
        const stat = await fs.lstat(verifiedPath);
        if (stat.isDirectory()) {
          throw new Error(`Path is a directory: ${relativePath}`);
        }
        existed = true;
      } catch (error: any) {
        if (error?.code !== 'ENOENT') throw error;
      }

      await atomicWriteFile(verifiedPath, content);
      const bytes = Buffer.byteLength(content, 'utf8');
      const size = bytesToSize(bytes);
      const verb = existed ? 'Overwrote' : 'Created';
      return `${verb} ${relativePath} (${size}).`;
    },
    definition: writeDefinition,
  };
};
