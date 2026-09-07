import { readFileSync } from 'node:fs';

const systemPrompt = readFileSync(new URL('../../prompts/system.md', import.meta.url), 'utf8');
const codingStandards = readFileSync(new URL('../../prompts/coding-standards.md', import.meta.url), 'utf8');

export const INSTRUCTIONS: string = `${systemPrompt.trim()}\n\n${codingStandards.trim()}`;
