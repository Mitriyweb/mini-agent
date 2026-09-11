import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.js';
import type { LLMProviderDefinition, ModelInfo, Provider, ProviderClientOptions } from './types.js';

export const routerProvider: LLMProviderDefinition = {
  id: 'router',
  name: 'Model Router',
  defaultBaseURL: 'http://localhost:8787/v1',
  defaultModel: 'model-router-auto',
  apiKeyEnvVar: 'OPENAI_API_KEY',

  resolveApiKey(customKey?: string): string {
    return (
      customKey ??
      process.env.OPENAI_API_KEY ??
      process.env.ANTHROPIC_API_KEY ??
      'dummy'
    );
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);

    try {
      const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });
      const response = await client.models.list();
      const models: ModelInfo[] = [];
      for await (const model of response) {
        models.push({ id: model.id, name: model.id });
      }
      if (models.length > 0) return models;
    } catch {
      // Fallback if model router is not reachable or does not serve /v1/models
    }

    return [{ id: this.defaultModel, name: this.defaultModel }];
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);
    const model = options.model ?? this.defaultModel;

    return createOpenAICompatibleClient(this.id, apiKey, baseURL, model, options);
  },
};
