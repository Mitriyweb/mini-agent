import type { CustomProviderConfig, CustomProviderModelsDiscovery, CustomProviderStaticModel } from '../../types/llm.ts';

export const BUILTIN_PROVIDER_IDS = ['router', 'openai', 'anthropic', 'google', 'zai'] as const;

const ENV_VAR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface CustomProviderFileEntry {
  name?: unknown;
  baseURL?: unknown;
  base_url?: unknown;
  apiKey?: unknown;
  api_key?: unknown;
  apiKeyEnvVar?: unknown;
  api_key_env_var?: unknown;
  defaultModel?: unknown;
  default_model?: unknown;
  fallbackModels?: unknown;
  fallback_models?: unknown;
  models?: unknown;
}

const fail = (id: string, message: string): never => {
  throw new Error(`Invalid custom provider '${id}': ${message}`);
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

const normalizeModelsDiscovery = (id: string, raw: unknown): CustomProviderModelsDiscovery => {
  if (raw === undefined || raw === null) {
    return { type: 'openai-compatible' };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(id, 'models must be an object describing the discovery method');
  }
  const m = raw as Record<string, unknown>;
  const type = asString(m.type);

  if (type === 'static' || (type === undefined && Array.isArray(m.list))) {
    const rawList = m.list;
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return fail(id, 'models.list must be a non-empty array for static discovery');
    }
    const normalized: Array<string | CustomProviderStaticModel> = rawList.map((item: unknown) => {
      if (typeof item === 'string' && item.trim().length > 0) return item.trim();
      if (typeof item === 'object' && item !== null) {
        const entry = item as Record<string, unknown>;
        const itemId = asString(entry.id);
        if (!itemId) return fail(id, 'each static models.list entry must be a string or an object with a non-empty id');
        const name = asString(entry.name);
        const description = asString(entry.description);
        return { id: itemId, ...(name ? { name } : {}), ...(description ? { description } : {}) };
      }
      return fail(id, 'each static models.list entry must be a string or an object with a non-empty id');
    });
    return { type: 'static', list: normalized };
  }

  if (type === 'endpoint' || (type === undefined && (asString(m.url) || asString(m.path)))) {
    const url = asString(m.url) ?? asString(m.path) ?? fail(id, 'models.url is required for endpoint discovery');
    const itemsPath = asString(m.itemsPath) ?? asString(m.items_path);
    const idField = asString(m.idField) ?? asString(m.id_field);
    const nameField = asString(m.nameField) ?? asString(m.name_field);
    return {
      type: 'endpoint',
      url,
      ...(itemsPath ? { itemsPath } : {}),
      ...(idField ? { idField } : {}),
      ...(nameField ? { nameField } : {}),
    };
  }

  if (type === 'openai-compatible' || type === undefined) {
    return { type: 'openai-compatible' };
  }

  return fail(id, "models.type must be one of 'openai-compatible', 'endpoint', or 'static'");
};

const normalizeEntry = (key: string, raw: unknown): CustomProviderConfig => {
  const id = key.trim().toLowerCase();
  if (!id) fail('(empty)', 'provider ID must be non-empty');
  if (BUILTIN_PROVIDER_IDS.includes(id as (typeof BUILTIN_PROVIDER_IDS)[number])) {
    fail(id, `provider ID collides with built-in provider '${id}'`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(id, 'provider entry must be an object');
  }

  const entry = raw as CustomProviderFileEntry;
  const baseURL = asString(entry.baseURL) ?? asString(entry.base_url) ?? fail(id, 'baseURL is required');
  try {
    const parsed = new URL(baseURL);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      fail(id, `baseURL must use http or https, got '${parsed.protocol}'`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Invalid custom provider')) throw err;
    fail(id, `baseURL is not a valid URL: '${baseURL}'`);
  }

  const defaultModel =
    asString(entry.defaultModel) ?? asString(entry.default_model) ?? fail(id, 'defaultModel is required');

  const apiKeyEnvVar = asString(entry.apiKeyEnvVar) ?? asString(entry.api_key_env_var);
  if (apiKeyEnvVar && !ENV_VAR_PATTERN.test(apiKeyEnvVar)) {
    fail(id, `apiKeyEnvVar '${apiKeyEnvVar}' is not a valid environment variable name`);
  }

  const fallbackRaw = entry.fallbackModels ?? entry.fallback_models;
  let fallbackModels: string[] = [];
  if (fallbackRaw !== undefined) {
    if (!Array.isArray(fallbackRaw) || fallbackRaw.some((v) => typeof v !== 'string' || v.trim().length === 0)) {
      return fail(id, 'fallbackModels must be an array of non-empty strings');
    }
    fallbackModels = (fallbackRaw as string[]).map((v) => v.trim());
  }

  const name = asString(entry.name) ?? key.trim();
  const apiKey = asString(entry.apiKey) ?? asString(entry.api_key);

  return {
    id,
    name,
    baseURL,
    ...(apiKey ? { apiKey } : {}),
    ...(apiKeyEnvVar ? { apiKeyEnvVar } : {}),
    defaultModel,
    fallbackModels,
    models: normalizeModelsDiscovery(id, entry.models),
  };
};

/**
 * Normalizes and validates the `providers` map from a config file.
 * Returns an empty record when no custom providers are configured.
 * Throws on the first invalid entry.
 */
export const normalizeCustomProviders = (raw: unknown): Record<string, CustomProviderConfig> => {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error("Invalid custom providers: 'providers' must be a map of provider ID to provider config");
  }
  const result: Record<string, CustomProviderConfig> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalized = normalizeEntry(key, value);
    if (result[normalized.id]) {
      throw new Error(`Invalid custom provider '${normalized.id}': duplicate provider ID`);
    }
    result[normalized.id] = normalized;
  }
  return result;
};
