import OpenAI from 'openai';
import { createOpenAICompatibleClient } from './common.js';
import type { LLMProviderDefinition, ModelInfo, Provider, ProviderClientOptions } from './types.js';

export const anthropicProvider: LLMProviderDefinition = {
  id: 'anthropic',
  name: 'Anthropic',
  defaultBaseURL: 'https://api.anthropic.com/v1',
  defaultModel: 'claude-3-5-sonnet-20241022',
  apiKeyEnvVar: 'ANTHROPIC_API_KEY',

  resolveApiKey(customKey?: string): string {
    return customKey ?? process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  },

  async getModels(options = {}): Promise<ModelInfo[]> {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);

    if (!apiKey) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY and try again.');
    }

    // Try Anthropic models API or OpenAI-compatible endpoint
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        if (Array.isArray(data.data)) {
          const models: ModelInfo[] = data.data.map((m: any) => ({
            id: m.id,
            name: m.display_name ?? m.id,
          }));
          if (models.length > 0) return models;
        }
      }
    } catch {
      // Fallback below
    }

    // Fallback if endpoint is custom OpenAI-compatible proxy or unreachable
    try {
      const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });
      const response = await client.models.list();
      const models: ModelInfo[] = [];
      for await (const model of response) {
        models.push({ id: model.id, name: model.id });
      }
      if (models.length > 0) return models;
    } catch {
      // Return known default Claude models if API list is not supported
    }

    return [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
    ];
  },

  createClient(options: ProviderClientOptions = {}): Provider {
    const baseURL = options.baseURL ?? this.defaultBaseURL;
    const apiKey = this.resolveApiKey(options.apiKey);
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured. Set ANTHROPIC_API_KEY and try again.');
    }
    const model = options.model ?? this.defaultModel;

    return createOpenAICompatibleClient(this.id, apiKey, baseURL, model, options);
  },
};
