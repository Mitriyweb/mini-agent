import { routerProvider } from './router.js';
import { openaiProvider } from './openai.js';
import { anthropicProvider } from './anthropic.js';
import { googleProvider } from './google.js';
import type { LLMProviderDefinition } from './types.js';

export class ProviderRegistry {
  private providers = new Map<string, LLMProviderDefinition>();

  constructor() {
    this.register(routerProvider);
    this.register(openaiProvider);
    this.register(anthropicProvider);
    this.register(googleProvider);
  }

  register(provider: LLMProviderDefinition): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  get(id: string): LLMProviderDefinition | undefined {
    if (!id) return undefined;
    return this.providers.get(id.toLowerCase());
  }

  list(): LLMProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  has(id: string): boolean {
    if (!id) return false;
    return this.providers.has(id.toLowerCase());
  }
}

export const defaultProviderRegistry = new ProviderRegistry();
