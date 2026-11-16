import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
}

export interface RetryConfig {
  enabled: boolean;
  maxAttempts: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
}

export interface ProviderClientOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  fallbacks?: string[];
  log?: (message: string) => void;
  retry?: Partial<RetryConfig>;
  delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface ProviderOptions extends ProviderClientOptions {
  provider?: string;
  /** User-declared custom providers from config, keyed by provider ID. */
  customProviders?: Record<string, CustomProviderConfig>;
}

export interface CustomProviderStaticModel {
  id: string;
  name?: string;
  description?: string;
}

export interface CustomProviderOpenAICompatibleDiscovery {
  type: 'openai-compatible';
}

export interface CustomProviderEndpointDiscovery {
  type: 'endpoint';
  /** Absolute URL or path relative to the provider baseURL. */
  url: string;
  /** Dotted path to the model array inside the JSON response. */
  itemsPath?: string;
  idField?: string;
  nameField?: string;
}

export interface CustomProviderStaticDiscovery {
  type: 'static';
  list: Array<string | CustomProviderStaticModel>;
}

export type CustomProviderModelsDiscovery =
  | CustomProviderOpenAICompatibleDiscovery
  | CustomProviderEndpointDiscovery
  | CustomProviderStaticDiscovery;

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseURL: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  defaultModel: string;
  fallbackModels: string[];
  models: CustomProviderModelsDiscovery;
}

export interface LLMRequest {
  messages: ChatCompletionMessageParam[];
  tools?: any[];
  signal?: AbortSignal;
}

export interface Provider {
  readonly providerId: string;
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  respond: (request: LLMRequest) => Promise<any>;
}

export interface LLMProviderDefinition {
  id: string;
  name: string;
  defaultBaseURL: string;
  defaultModel: string;
  apiKeyEnvVar: string;
  resolveApiKey(customKey?: string): string;
  getModels(options?: { apiKey?: string; baseURL?: string }): Promise<ModelInfo[]>;
  createClient(options?: ProviderClientOptions): Provider;
}
