import { getConfig, loadConfigFile } from './config.ts';
import { defaultProviderRegistry, ProviderRegistry } from './providers/registry.ts';
import { createOpenAICompatibleClient } from './providers/common.ts';
import { createCustomProviderDefinition } from './providers/custom.ts';
import { normalizeCustomProviders } from './providers/custom-config.ts';
import type { CustomProviderConfig, Provider, ProviderOptions, RetryConfig } from '../types/llm.ts';

export { createWithRetry, createOpenAICompatibleClient } from './providers/common.ts';

const loadConfiguredCustomProviders = (): Record<string, CustomProviderConfig> => {
  try {
    const fileConfig = loadConfigFile();
    return normalizeCustomProviders(fileConfig.providers);
  } catch {
    return {};
  }
};

export const createProvider = (
  options: ProviderOptions & { registry?: ProviderRegistry; retry?: Partial<RetryConfig> } = {},
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
  const customProviders = options.customProviders ?? loadConfiguredCustomProviders();

  if (!providerDef) {
    const customEntry = customProviders[providerId];
    if (customEntry) {
      const customDef = createCustomProviderDefinition(providerId, customEntry);
      return customDef.createClient({
        apiKey: options.apiKey,
        model: options.model ?? (options.provider ? undefined : process.env.MODEL ?? config.MODEL),
        baseURL: options.baseURL ?? (options.provider ? undefined : process.env.OPENAI_BASE_URL ?? config.BASE_URL),
        fallbacks: options.fallbacks ?? [...customEntry.fallbackModels, ...(config.FALLBACK_MODELS ?? [])],
        log: options.log,
        retry: options.retry,
      });
    }
    if (options.baseURL || process.env.OPENAI_BASE_URL || config.BASE_URL) {
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY ?? config.API_KEY ?? 'dummy';
      const baseURL = options.baseURL ?? process.env.OPENAI_BASE_URL ?? config.BASE_URL ?? 'http://localhost:8787/v1';
      const model = options.model ?? process.env.MODEL ?? config.MODEL ?? 'model-router-auto';
      return createOpenAICompatibleClient(providerId, apiKey, baseURL, model, {
        ...options,
        retry: options.retry,
      });
    }
    const available = [
      ...registry.list().map((p) => p.id),
      ...Object.keys(customProviders),
    ].join(', ');
    throw new Error(
      `Unknown LLM provider: '${providerId}'. Available providers: ${available}`,
    );
  }

  const clientOptions = {
    apiKey: options.apiKey,
    model: options.model ?? (options.provider ? undefined : process.env.MODEL ?? config.MODEL),
    baseURL: options.baseURL ?? (options.provider ? undefined : process.env.OPENAI_BASE_URL ?? config.BASE_URL),
    fallbacks: options.fallbacks ?? config.FALLBACK_MODELS,
    log: options.log,
    retry: options.retry,
  };

  return providerDef.createClient(clientOptions);
};
