import { atomicWriteFile, normalizeNewlines, readTextFile } from '../utils/textfile.js';
import type { Tool, ToolDefinition, ToolEnvironment } from '../types/tools.js';

export interface Hunk {
  old_text: string;
  new_text: string;
}

export interface PatchArgs {
  path: string;
  hunks: Hunk[];
}

export const patchDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'patch',
    description: 'Apply multiple hunk replacements (old_text -> new_text) sequentially to a workspace text file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root.',
        },
        hunks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              old_text: {
                type: 'string',
                description: 'Exact substring to replace.',
              },
              new_text: {
                type: 'string',
                description: 'Replacement string.',
              },
            },
            required: ['old_text', 'new_text'],
          },
          description: 'List of replacement hunks.',
        },
      },
      required: ['path', 'hunks'],
    },
  },
};

const applyHunk = (content: string, hunk: Hunk, index: number, relativePath: string): string => {
  if (typeof hunk !== 'object' || hunk === null) {
    throw new Error(`hunks[${index}] must be an object.`);
  }
  const oldText = hunk.old_text;
  const newText = hunk.new_text;
  if (typeof oldText !== 'string' || oldText.length === 0) {
    throw new Error(`hunks[${index}].old_text must be a non-empty string.`);
  }
  if (typeof newText !== 'string') {
    throw new Error(`hunks[${index}].new_text must be a string.`);
  }

  // Exact match attempt
  let parts = content.split(oldText);
  let occurrences = parts.length - 1;
  if (occurrences === 1) {
    return content.replace(oldText, newText);
  }

  // Normalized match attempt
  const normContent = normalizeNewlines(content);
  const normOld = normalizeNewlines(oldText);
  const normParts = normContent.split(normOld);
  const normOccurrences = normParts.length - 1;

  if (normOccurrences === 0) {
    throw new Error(`hunks[${index}].old_text was not found in ${relativePath}.`);
  }
  if (normOccurrences !== 1) {
    const where = `hunks[${index}].old_text`;
    const times = `occurs ${normOccurrences} times in ${relativePath}`;
    throw new Error(`${where} ${times}; provide a unique match.`);
  }

  const normNew = normalizeNewlines(newText);
  return normContent.replace(normOld, normNew);
};

export const createPatchTool = (env: ToolEnvironment): Tool<PatchArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: true,
    trust: 'path',
    describe(args) {
      const relativePath = args.path;
      const hunks = args.hunks;
      const count = Array.isArray(hunks) ? hunks.length : 0;
      return `patch ${relativePath} (${count} hunks)`;
    },
    async execute(args) {
      const relativePath = args.path;
      const hunks = args.hunks;
      if (!Array.isArray(hunks) || hunks.length === 0) {
        throw new Error('hunks must be a non-empty array.');
      }

      const filePath = await workspace.resolveExistingFile(relativePath);
      const rawContent = await readTextFile(filePath);
      const isCRLF = rawContent.includes('\r\n');

      let current = rawContent;
      for (let index = 0; index < hunks.length; index += 1) {
        const hunk = hunks[index];
        current = applyHunk(current, hunk, index, relativePath);
      }

      const finalUpdated = isCRLF ? normalizeNewlines(current).replace(/\n/g, '\r\n') : current;
      await atomicWriteFile(filePath, finalUpdated);
      return `Patched ${relativePath} (${hunks.length} hunks).`;
    },
    definition: patchDefinition,
  };
};
