import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.ts';
import type { LLMProviderDefinition, ModelInfo, Provider, ProviderClientOptions } from './types.ts';

export const openaiProvider: LLMProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  defaultBaseURL: 'https://api.openai.com/v1',
  defaultModel: 'gpt-4o',
  apiKeyEnvVar: 'OPENAI_API_KEY',

  resolveApiKey(customKey?: string): string {
    return customKey ?? process.env.OPENAI_API_KEY ?? '';
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);

    if (!apiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY and try again.');
    }

    const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });
    const response = await client.models.list();
    const models: ModelInfo[] = [];

    for await (const model of response) {
      models.push({ id: model.id, name: model.id });
    }

    // Sort to show gpt models first
    models.sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) {
      return [
        { id: 'gpt-4o', name: 'gpt-4o' },
        { id: 'gpt-4o-mini', name: 'gpt-4o-mini' },
        { id: 'gpt-4.5-preview', name: 'gpt-4.5-preview' },
        { id: 'o1', name: 'o1' },
        { id: 'o3-mini', name: 'o3-mini' },
      ];
    }

    return models;
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error('OpenAI API key is not configured. Set OPENAI_API_KEY and try again.');
    }
    const model = options.model ?? this.defaultModel;

    return createOpenAICompatibleClient(this.id, apiKey, baseURL, model, options);
  },
};
