import { describe, expect, test } from 'bun:test';
import { createProvider } from '../src/agent/llm.js';
import { defaultProviderRegistry, ProviderRegistry } from '../src/agent/providers/registry.js';
import { parseArgs } from '../src/start.js';

describe('LLM Providers & Registry Test Suite', () => {
  test('Provider Registry lists and retrieves built-in providers', () => {
    const registry = new ProviderRegistry();
    const providers = registry.list();
    expect(providers.length).toBeGreaterThanOrEqual(4);

    const providerIds = providers.map((p) => p.id);
    expect(providerIds).toContain('router');
    expect(providerIds).toContain('openai');
    expect(providerIds).toContain('anthropic');
    expect(providerIds).toContain('google');

    expect(registry.has('router')).toBe(true);
    expect(registry.has('OPENAI')).toBe(true);
    expect(registry.has('anthropic')).toBe(true);
    expect(registry.has('google')).toBe(true);
  });

  test('Router Mode creates default client targeting http://localhost:8787/v1', () => {
    const provider = createProvider({ provider: 'router' });
    expect(provider.providerId).toBe('router');
    expect(provider.baseURL).toBe('http://localhost:8787/v1');
    expect(provider.model).toBe('model-router-auto');
  });

  test('Router Mode is default when no provider is specified (backward compatibility)', () => {
    const provider = createProvider({});
    expect(provider.providerId).toBe('router');
    expect(provider.baseURL).toBe('http://localhost:8787/v1');
    expect(provider.model).toBe('model-router-auto');
  });

  test('Direct OpenAI Mode bypasses router and targets OpenAI base URL', () => {
    const provider = createProvider({
      provider: 'openai',
      apiKey: 'test-openai-key',
      model: 'gpt-4o',
    });
    expect(provider.providerId).toBe('openai');
    expect(provider.baseURL).toBe('https://api.openai.com/v1');
    expect(provider.model).toBe('gpt-4o');
    expect(provider.apiKey).toBe('test-openai-key');
  });

  test('Direct Anthropic Mode targets Anthropic base URL', () => {
    const provider = createProvider({
      provider: 'anthropic',
      apiKey: 'test-anthropic-key',
      model: 'claude-3-5-sonnet-20241022',
    });
    expect(provider.providerId).toBe('anthropic');
    expect(provider.baseURL).toBe('https://api.anthropic.com/v1');
    expect(provider.model).toBe('claude-3-5-sonnet-20241022');
    expect(provider.apiKey).toBe('test-anthropic-key');
  });

  test('Direct Google Mode targets Google Gemini OpenAI-compatible base URL', () => {
    const provider = createProvider({
      provider: 'google',
      apiKey: 'test-google-key',
      model: 'gemini-1.5-flash',
    });
    expect(provider.providerId).toBe('google');
    expect(provider.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(provider.model).toBe('gemini-1.5-flash');
    expect(provider.apiKey).toBe('test-google-key');
  });

  test('Missing API Key throws clear error for direct providers', () => {
    const origEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      expect(() => {
        createProvider({ provider: 'openai' });
      }).toThrow(/OpenAI API key is not configured/);
    } finally {
      process.env.OPENAI_API_KEY = origEnv;
    }
  });

  test('Model Discovery: router getModels returns models or fallback auto model', async () => {
    const routerDef = defaultProviderRegistry.get('router');
    expect(routerDef).toBeDefined();

    const models = await routerDef!.getModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models[0].id).toBeDefined();
  });

  test('Model Discovery: missing API key throws clear error when fetching models', async () => {
    const openaiDef = defaultProviderRegistry.get('openai');
    expect(openaiDef).toBeDefined();

    const origEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      await expect(openaiDef!.getModels({ apiKey: '' })).rejects.toThrow(
        /OpenAI API key is not configured/,
      );
    } finally {
      process.env.OPENAI_API_KEY = origEnv;
    }
  });

  test('Model Discovery: returns mock model list when API succeeds', async () => {
    const customDef = {
      id: 'mock',
      name: 'Mock Provider',
      defaultBaseURL: 'http://localhost:9999/v1',
      defaultModel: 'mock-1',
      apiKeyEnvVar: 'MOCK_KEY',
      resolveApiKey: () => 'mock-key',
      getModels: async () => [
        { id: 'mock-1', name: 'Mock Model One' },
        { id: 'mock-2', name: 'Mock Model Two' },
      ],
      createClient: (opts: any) => ({
        providerId: 'mock',
        model: opts?.model ?? 'mock-1',
        baseURL: 'http://localhost:9999/v1',
        apiKey: 'mock-key',
        respond: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      }),
    };

    const registry = new ProviderRegistry();
    registry.register(customDef);

    const mockDef = registry.get('mock');
    expect(mockDef).toBeDefined();

    const models = await mockDef!.getModels();
    expect(models).toEqual([
      { id: 'mock-1', name: 'Mock Model One' },
      { id: 'mock-2', name: 'Mock Model Two' },
    ]);
  });

  test('Runtime switching creates updated client instance', () => {
    let currentProvider = createProvider({ provider: 'router', model: 'model-router-auto' });
    expect(currentProvider.providerId).toBe('router');
    expect(currentProvider.model).toBe('model-router-auto');

    // Switch router -> openai
    currentProvider = createProvider({
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
    });
    expect(currentProvider.providerId).toBe('openai');
    expect(currentProvider.model).toBe('gpt-4o');

    // Switch openai -> anthropic
    currentProvider = createProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-3-5-sonnet-20241022',
    });
    expect(currentProvider.providerId).toBe('anthropic');
    expect(currentProvider.model).toBe('claude-3-5-sonnet-20241022');

    // Switch model A -> model B
    currentProvider = createProvider({
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-3-5-haiku-20241022',
    });
    expect(currentProvider.providerId).toBe('anthropic');
    expect(currentProvider.model).toBe('claude-3-5-haiku-20241022');
  });

  test('parseArgs parses --provider and -p flags correctly', () => {
    const parsed1 = parseArgs(['node', 'start.js', '--provider', 'openai', '--model', 'gpt-4o']);
    expect(parsed1.customProvider).toBe('openai');
    expect(parsed1.customModel).toBe('gpt-4o');

    const parsed2 = parseArgs(['node', 'start.js', '-p', 'anthropic', 'do something']);
    expect(parsed2.customProvider).toBe('anthropic');
    expect(parsed2.task).toBe('do something');
  });

  test('Backward compatibility: parseArgs preserves existing flags', () => {
    const parsed = parseArgs([
      'node',
      'start.js',
      '-y',
      '--model',
      'custom-model',
      '--url',
      'http://localhost:8787/v1',
      '--max-steps',
      '15',
      'my task',
    ]);

    expect(parsed.autoApprove).toBe(true);
    expect(parsed.customModel).toBe('custom-model');
    expect(parsed.customUrl).toBe('http://localhost:8787/v1');
    expect(parsed.maxSteps).toBe(15);
    expect(parsed.task).toBe('my task');
    expect(parsed.customProvider).toBeUndefined();
  });
});
