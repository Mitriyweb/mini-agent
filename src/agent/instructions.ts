import systemPrompt from '../../prompts/system.md' with { type: 'text' };
import codingStandards from '../../prompts/coding-standards.md' with { type: 'text' };

export const INSTRUCTIONS: string = `${systemPrompt.trim()}\n\n${codingStandards.trim()}`;
