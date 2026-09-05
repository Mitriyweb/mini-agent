import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface ProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  fallbacks?: string[];
  log?: (message: string) => void;
}

export interface LLMRequest {
  messages: ChatCompletionMessageParam[];
  tools?: any[];
}

export interface Provider {
  readonly model: string;
  readonly baseURL: string;
  readonly apiKey: string;
  respond: (request: LLMRequest) => Promise<any>;
}
