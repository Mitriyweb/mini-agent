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
