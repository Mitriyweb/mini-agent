import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.js';
import type { LLMProviderDefinition, ModelInfo, Provider, ProviderClientOptions } from './types.js';

export const googleProvider: LLMProviderDefinition = {
  id: 'google',
  name: 'Google Gemini',
  defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  defaultModel: 'gemini-1.5-flash',
  apiKeyEnvVar: 'GEMINI_API_KEY',

  resolveApiKey(customKey?: string): string {
    return customKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);

    if (!apiKey) {
      throw new Error('Google API key is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY and try again.');
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
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash' },
    ];
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error('Google API key is not configured. Set GEMINI_API_KEY or GOOGLE_API_KEY and try again.');
    }
    const model = options.model ?? this.defaultModel;

    return createOpenAICompatibleClient(this.id, apiKey, baseURL, model, options);
  },
};
