import { routerProvider } from './router.ts';
import { openaiProvider } from './openai.ts';
import { anthropicProvider } from './anthropic.ts';
import { googleProvider } from './google.ts';
import type { LLMProviderDefinition } from './types.ts';

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
