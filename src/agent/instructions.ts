import { readFileSync } from 'node:fs';

const loadPrompt = async (fileName: string): Promise<string> => {
	if (process.versions.bun) {
		const prompts = await import('./bun-prompts.ts');
		return fileName === 'system.md' ? prompts.systemPrompt : prompts.codingStandards;
	}

	return readFileSync(new URL(`../../prompts/${fileName}`, import.meta.url), 'utf8');
};

const systemPrompt = await loadPrompt('system.md');
const codingStandards = await loadPrompt('coding-standards.md');

export const INSTRUCTIONS: string = `${systemPrompt.trim()}\n\n${codingStandards.trim()}`;
