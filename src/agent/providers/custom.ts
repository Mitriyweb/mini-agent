import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.ts';
import { openAIProviderFetch, providerFetch } from './transport.ts';
import type { ProviderRegistry } from './registry.ts';
import type {
  CustomProviderConfig,
  CustomProviderEndpointDiscovery,
  LLMProviderDefinition,
  ModelInfo,
  Provider,
  ProviderClientOptions,
} from './types.ts';

const defaultModelFallback = (entry: CustomProviderConfig): ModelInfo[] => [
  { id: entry.defaultModel, name: entry.defaultModel },
];

const resolveCustomApiKey = (entry: CustomProviderConfig, customKey?: string): string =>
  customKey ??
  entry.apiKey ??
  (entry.apiKeyEnvVar ? process.env[entry.apiKeyEnvVar] : undefined) ??
  process.env.OPENAI_API_KEY ??
  process.env.ANTHROPIC_API_KEY ??
  'dummy';

const resolveModelsBaseURL = (entry: CustomProviderConfig, options: { apiKey?: string; baseURL?: string } = {}): { baseURL: string; apiKey: string } => ({
  baseURL: options.baseURL ?? entry.baseURL,
  apiKey: resolveCustomApiKey(entry, options.apiKey),
});

const getOpenAICompatibleModels = async (
  entry: CustomProviderConfig,
  options: { apiKey?: string; baseURL?: string } = {},
): Promise<ModelInfo[]> => {
  const { baseURL, apiKey } = resolveModelsBaseURL(entry, options);
  try {
    const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true, fetch: openAIProviderFetch });
    const response = await client.models.list();
    const models: ModelInfo[] = [];
    for await (const model of response) {
      models.push({ id: model.id, name: model.id });
    }
    if (models.length > 0) return models;
  } catch {
    // Fall back to the default model below
  }
  return defaultModelFallback(entry);
};

const resolveEndpointURL = (entry: CustomProviderConfig, url: string): string => {
  if (/^https?:\/\//i.test(url)) return url;
  const base = entry.baseURL.replace(/\/+$/, '');
  const path = url.replace(/^\/+/, '');
  return `${base}/${path}`;
};

const getPathValue = (obj: unknown, path: string): unknown => {
  let current = obj;
  for (const segment of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const getEndpointModels = async (
  entry: CustomProviderConfig,
  discovery: CustomProviderEndpointDiscovery,
  options: { apiKey?: string; baseURL?: string } = {},
): Promise<ModelInfo[]> => {
  const { baseURL, apiKey } = resolveModelsBaseURL(entry, options);
  const effectiveEntry = { ...entry, baseURL };
  const url = resolveEndpointURL(effectiveEntry, discovery.url);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (apiKey && apiKey !== 'dummy') headers.authorization = `Bearer ${apiKey}`;
    const response = await providerFetch(url, { headers });
    if (!response.ok) return defaultModelFallback(entry);
    const body = await response.json();

    let items: unknown = body;
    if (discovery.itemsPath) {
      items = getPathValue(body, discovery.itemsPath);
    } else if (Array.isArray(body)) {
      items = body;
    } else {
      items = getPathValue(body, 'data') ?? getPathValue(body, 'models');
    }
    if (!Array.isArray(items)) return defaultModelFallback(entry);

    const idField = discovery.idField ?? 'id';
    const nameField = discovery.nameField ?? 'name';
    const models: ModelInfo[] = [];
    for (const item of items) {
      if (typeof item === 'string' && item.trim().length > 0) {
        models.push({ id: item.trim(), name: item.trim() });
        continue;
      }
      if (typeof item !== 'object' || item === null) continue;
      const record = item as Record<string, unknown>;
      const rawId = record[idField] ?? record.id ?? record.name;
      if (typeof rawId !== 'string' || rawId.trim().length === 0) continue;
      const id = rawId.trim();
      const rawName = record[nameField];
      models.push({
        id,
        name: typeof rawName === 'string' && rawName.trim().length > 0 ? rawName.trim() : id,
      });
    }
    return models.length > 0 ? models : defaultModelFallback(entry);
  } catch {
    return defaultModelFallback(entry);
  }
};

const getStaticModels = (entry: CustomProviderConfig): ModelInfo[] => {
  const discovery = entry.models;
  if (discovery.type !== 'static') return defaultModelFallback(entry);
  return discovery.list.map((item) =>
    typeof item === 'string'
      ? { id: item, name: item }
      : { id: item.id, name: item.name ?? item.id, ...(item.description ? { description: item.description } : {}) },
  );
};

export const createCustomProviderDefinition = (
  id: string,
  entry: CustomProviderConfig,
): LLMProviderDefinition => ({
  id,
  name: entry.name,
  defaultBaseURL: entry.baseURL,
  defaultModel: entry.defaultModel,
  apiKeyEnvVar: entry.apiKeyEnvVar ?? '',

  resolveApiKey(customKey?: string): string {
    return resolveCustomApiKey(entry, customKey);
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const discovery = entry.models;
    try {
      if (discovery.type === 'static') return getStaticModels(entry);
      if (discovery.type === 'endpoint') return await getEndpointModels(entry, discovery, options);
      return await getOpenAICompatibleModels(entry, options);
    } catch {
      return defaultModelFallback(entry);
    }
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? entry.baseURL;
    const apiKey = resolveCustomApiKey(entry, options.apiKey);
    const model = options.model ?? entry.defaultModel;
    const fallbacks = options.fallbacks ?? entry.fallbackModels;

    return createOpenAICompatibleClient(id, apiKey, baseURL, model, { ...options, fallbacks });
  },
});

/**
 * Registers each configured custom provider into the registry.
 * Built-in providers always win; entries that collide are skipped.
 */
export const registerCustomProviders = (
  registry: ProviderRegistry,
  customProviders: Record<string, CustomProviderConfig>,
): void => {
  for (const [id, entry] of Object.entries(customProviders)) {
    if (!registry.has(id)) {
      registry.register(createCustomProviderDefinition(id, entry));
    }
  }
};
