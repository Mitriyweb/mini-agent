import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.ts';
import type { LLMProviderDefinition, ModelInfo, Provider, ProviderClientOptions } from './types.ts';

export const zaiProvider: LLMProviderDefinition = {
  id: 'zai',
  name: 'Z.AI',
  defaultBaseURL: 'https://api.z.ai/api/coding/paas/v4',
  defaultModel: 'glm-5.3-highspeed',
  apiKeyEnvVar: 'ZAI_API_KEY',

  resolveApiKey(customKey?: string): string {
    return customKey ?? process.env.ZAI_API_KEY ?? '';
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);

    if (!apiKey) {
      throw new Error('Z.AI API key is not configured. Set ZAI_API_KEY and try again.');
    }

    try {
      const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });
      const response = await client.models.list();
      const models: ModelInfo[] = [];
      for await (const model of response) {
        models.push({ id: model.id, name: model.id });
      }
      if (models.length > 0) return models;
    } catch {
      // Return defaults below
    }

    return [
      { id: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed' },
    ];
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error('Z.AI API key is not configured. Set ZAI_API_KEY and try again.');
    }
    const model = options.model ?? this.defaultModel;

    return createOpenAICompatibleClient(this.id, apiKey, baseURL, model, options);
  },
};
