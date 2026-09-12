import type { Interface as ReadlineInterface } from 'node:readline/promises';
import concolor from 'concolor';
import { defaultProviderRegistry, ProviderRegistry } from './providers/registry.js';
import type { LLMProviderDefinition, ModelInfo } from '../types/llm.js';

const color = (concolor as any)({
  info: 'b,blue',
  warn: 'b,yellow',
  error: 'b,red',
  cyan: 'b,cyan',
  dim: 'gray',
});

export const promptSelectProvider = async (
  rl: ReadlineInterface,
  registry: ProviderRegistry = defaultProviderRegistry,
): Promise<LLMProviderDefinition> => {
  const providers = registry.list();
  console.log(color.info('\nAvailable LLM Providers:'));
  providers.forEach((p, idx) => {
    console.log(`  ${idx + 1}. ${p.name} (${color.cyan(p.id)})`);
  });

  const answer = await rl.question(
    color.cyan(`\nSelect provider [1-${providers.length}] (default: router): `),
  );
  const trimmed = answer.trim();
  if (!trimmed) {
    return registry.get('router')!;
  }

  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= providers.length) {
    return providers[num - 1];
  }

  const found = registry.get(trimmed);
  if (found) return found;

  console.log(color.warn(`Unknown provider '${trimmed}', defaulting to 'router'.`));
  return registry.get('router')!;
};

export const promptSelectModel = async (
  rl: ReadlineInterface,
  providerDef: LLMProviderDefinition,
  options: { apiKey?: string; baseURL?: string } = {},
): Promise<string> => {
  console.log(color.info(`\nFetching available models for ${providerDef.name}...`));
  let models: ModelInfo[] = [];

  try {
    models = await providerDef.getModels(options);
  } catch (err: any) {
    console.log(color.error(`\nError fetching models: ${err?.message ?? err}`));
    console.log(color.warn(`Falling back to default model: ${providerDef.defaultModel}`));
    return providerDef.defaultModel;
  }

  if (models.length === 0) {
    console.log(color.warn(`No models found. Using default model: ${providerDef.defaultModel}`));
    return providerDef.defaultModel;
  }

  console.log(color.info(`\nAvailable models for ${providerDef.name}:`));
  const displayModels = models.slice(0, 20);
  displayModels.forEach((m, idx) => {
    const label = m.name && m.name !== m.id ? `${m.id} (${m.name})` : m.id;
    console.log(`  ${idx + 1}. ${label}`);
  });
  if (models.length > 20) {
    console.log(color.dim(`  ... and ${models.length - 20} more`));
  }

  const answer = await rl.question(
    color.cyan(`\nSelect model [1-${displayModels.length}] or enter custom model ID (default: ${providerDef.defaultModel}): `),
  );
  const trimmed = answer.trim();
  if (!trimmed) return providerDef.defaultModel;

  const num = parseInt(trimmed, 10);
  if (!Number.isNaN(num) && num >= 1 && num <= displayModels.length) {
    return displayModels[num - 1].id;
  }

  return trimmed;
};
