import fs from 'node:fs/promises';
import path from 'node:path';
import { INSTRUCTIONS } from './instructions.js';

export interface SystemPromptConfig {
  enabled: boolean;
  path?: string;
}

export const resolveSystemPrompt = async (
  config: SystemPromptConfig,
  workspaceRoot?: string,
): Promise<string> => {
  if (!config.enabled) {
    return '';
  }

  if (config.path) {
    const resolvedPath = workspaceRoot ? path.resolve(workspaceRoot, config.path) : path.resolve(config.path);
    try {
      const customContent = await fs.readFile(resolvedPath, 'utf8');
      return customContent.trim();
    } catch (err: any) {
      throw new Error(`Failed to read custom system prompt file at '${resolvedPath}': ${err?.message ?? err}`);
    }
  }

  return INSTRUCTIONS;
};
