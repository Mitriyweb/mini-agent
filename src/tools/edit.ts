import { atomicWriteFile, normalizeNewlines, readTextFile } from '../utils/textfile.js';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.js';

export interface EditArgs {
  path: string;
  old_text: string;
  new_text: string;
}

export const editDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit',
    description: 'Replace an exact unique substring in a workspace text file.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path relative to the workspace root.',
        },
        old_text: {
          type: 'string',
          description: 'Exact substring to find and replace (must match uniquely).',
        },
        new_text: {
          type: 'string',
          description: 'Replacement substring.',
        },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
};

export const createEditTool = (env: ToolEnvironment): Tool<EditArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: true,
    trust: TrustKind.PATH,
    describe(args) {
      return `edit ${args.path}`;
    },
    async execute(args) {
      const relativePath = args.path;
      const oldText = args.old_text;
      const newText = args.new_text;
      if (!oldText || oldText.length === 0) throw new Error('old_text must not be empty.');

      const filePath = await workspace.resolveExistingFile(relativePath);
      const rawContent = await readTextFile(filePath);

      // Check direct exact match first
      let parts = rawContent.split(oldText);
      let occurrences = parts.length - 1;

      if (occurrences === 1) {
        const updated = rawContent.replace(oldText, newText);
        await atomicWriteFile(filePath, updated);
        return `Edited ${relativePath}.`;
      }

      // Handle CRLF / LF line ending differences
      const normalizedContent = normalizeNewlines(rawContent);
      const normalizedOldText = normalizeNewlines(oldText);
      const normalizedParts = normalizedContent.split(normalizedOldText);
      const normalizedOccurrences = normalizedParts.length - 1;

      if (normalizedOccurrences === 0) {
        throw new Error(`old_text was not found in ${relativePath}.`);
      }

      if (normalizedOccurrences !== 1) {
        const hint = 'provide a unique match.';
        throw new Error(
          `old_text occurs ${normalizedOccurrences} times in ${relativePath}; ${hint}`,
        );
      }

      // Perform normalized replacement while preserving original file newline style if possible
      const normalizedNewText = normalizeNewlines(newText);
      const updatedNormalized = normalizedContent.replace(normalizedOldText, normalizedNewText);

      const isCRLF = rawContent.includes('\r\n');
      const finalUpdated = isCRLF ? updatedNormalized.replace(/\n/g, '\r\n') : updatedNormalized;

      await atomicWriteFile(filePath, finalUpdated);
      return `Edited ${relativePath}.`;
    },
    definition: editDefinition,
  };
};
