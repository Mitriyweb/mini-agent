import { getConfig } from './config.js';
import { defaultProviderRegistry, ProviderRegistry } from './providers/registry.js';
import { createOpenAICompatibleClient } from './providers/common.js';
import type { Provider, ProviderOptions } from '../types/llm.js';

export { createWithRetry, createOpenAICompatibleClient } from './providers/common.js';

export const createProvider = (
  options: ProviderOptions & { registry?: ProviderRegistry } = {},
): Provider => {
  const config = getConfig();
  const registry = options.registry ?? defaultProviderRegistry;
  const providerId = (
    options.provider ??
    process.env.PROVIDER ??
    config.PROVIDER ??
    'router'
  ).toLowerCase();

  const providerDef = registry.get(providerId);

  if (!providerDef) {
    if (options.baseURL || process.env.OPENAI_BASE_URL || config.BASE_URL) {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? config.API_KEY ?? 'dummy';
      const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL ?? config.BASE_URL ?? 'http://localhost:8787/v1';
      const model = options.model ?? process.env.MODEL ?? config.MODEL ?? 'model-router-auto';
      return createOpenAICompatibleClient(providerId, apiKey, baseURL, model, options);
    }
    throw new Error(
      `Unknown LLM provider: '${providerId}'. Available providers: ${registry.list().map((p) => p.id).join(', ')}`,
    );
  }

  const clientOptions = {
    apiKey: options.apiKey,
    model: options.model ?? (options.provider ? undefined : process.env.MODEL ?? config.MODEL),
    baseURL: options.baseURL ?? (options.provider ? undefined : process.env.OPENAI_BASE_URL ?? config.BASE_URL),
    fallbacks: options.fallbacks ?? config.FALLBACK_MODELS,
    log: options.log,
  };

  return providerDef.createClient(clientOptions);
};
