import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { normalizeCustomProviders } from '../src/agent/providers/custom-config.js';
import { createCustomProviderDefinition, registerCustomProviders } from '../src/agent/providers/custom.js';
import { ProviderRegistry } from '../src/agent/providers/registry.js';
import { createProvider } from '../src/agent/llm.js';
import { resolveAgentConfig } from '../src/agent/config.js';
import type { AddressInfo } from 'node:net';

const validEntry = {
  baseURL: 'https://llmlite.example.com/v1',
  defaultModel: 'auto',
};

describe('Custom Providers - config normalization & validation', () => {
  test('returns empty record when providers is absent', () => {
    expect(normalizeCustomProviders(undefined)).toEqual({});
    expect(normalizeCustomProviders(null)).toEqual({});
  });

  test('normalizes a minimal entry with defaults', () => {
    const result = normalizeCustomProviders({ llmlite: validEntry });
    expect(result.llmlite).toMatchObject({
      id: 'llmlite',
      name: 'llmlite',
      baseURL: 'https://llmlite.example.com/v1',
      defaultModel: 'auto',
      fallbackModels: [],
      models: { type: 'openai-compatible' },
    });
  });

  test('accepts snake_case aliases', () => {
    const result = normalizeCustomProviders({
      myrouter: {
        base_url: 'http://localhost:9000/v1',
        default_model: 'm1',
        api_key_env_var: 'MYROUTER_API_KEY',
        fallback_models: ['m2'],
      },
    });
    expect(result.myrouter).toMatchObject({
      baseURL: 'http://localhost:9000/v1',
      defaultModel: 'm1',
      apiKeyEnvVar: 'MYROUTER_API_KEY',
      fallbackModels: ['m2'],
    });
  });

  test('rejects non-map providers config', () => {
    expect(() => normalizeCustomProviders(['x'])).toThrow(/must be a map/);
    expect(() => normalizeCustomProviders('nope')).toThrow(/must be a map/);
  });

  test('rejects built-in ID collisions', () => {
    expect(() => normalizeCustomProviders({ openai: validEntry })).toThrow(/collides with built-in/);
    expect(() => normalizeCustomProviders({ ROUTER: validEntry })).toThrow(/collides with built-in/);
  });

  test('rejects missing or invalid baseURL', () => {
    expect(() => normalizeCustomProviders({ x: { defaultModel: 'm' } })).toThrow(/baseURL is required/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, baseURL: 'not a url' } })).toThrow(/not a valid URL/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, baseURL: 'ftp://x' } })).toThrow(/http or https/);
  });

  test('rejects missing defaultModel', () => {
    expect(() => normalizeCustomProviders({ x: { baseURL: 'https://x.com' } })).toThrow(/defaultModel is required/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, defaultModel: '  ' } })).toThrow(/defaultModel is required/);
  });

  test('rejects invalid apiKeyEnvVar and fallbackModels', () => {
    expect(() => normalizeCustomProviders({ x: { ...validEntry, apiKeyEnvVar: '1BAD' } })).toThrow(/environment variable name/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, fallbackModels: 'm1' } })).toThrow(/fallbackModels/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, fallbackModels: [1] } })).toThrow(/fallbackModels/);
  });

  test('rejects duplicate IDs after case normalization', () => {
    expect(() =>
      normalizeCustomProviders({ Foo: validEntry, foo: validEntry }),
    ).toThrow(/duplicate provider ID/);
  });

  test('rejects invalid models discovery config', () => {
    expect(() => normalizeCustomProviders({ x: { ...validEntry, models: 'static' } })).toThrow(/models must be an object/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, models: { type: 'bogus' } } })).toThrow(/models.type/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, models: { type: 'endpoint' } } })).toThrow(/models.url is required/);
    expect(() => normalizeCustomProviders({ x: { ...validEntry, models: { type: 'static', list: [] } } })).toThrow(/non-empty array/);
  });

  test('normalizes static and endpoint discovery configs', () => {
    const result = normalizeCustomProviders({
      a: { ...validEntry, models: { type: 'static', list: ['m1', { id: 'm2', name: 'Model 2' }] } },
      b: {
        ...validEntry,
        models: { type: 'endpoint', url: '/api/models', itemsPath: 'data.items', idField: 'model', nameField: 'label' },
      },
    });
    expect(result.a.models).toEqual({ type: 'static', list: ['m1', { id: 'm2', name: 'Model 2' }] });
    expect(result.b.models).toEqual({
      type: 'endpoint',
      url: '/api/models',
      itemsPath: 'data.items',
      idField: 'model',
      nameField: 'label',
    });
  });
});

describe('Custom Providers - resolveAgentConfig integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-custom-provider-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('parses providers section from config file', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      `providers:\n  llmlite:\n    baseURL: https://llmlite.example.com/v1\n    defaultModel: auto\n    models:\n      type: static\n      list: [auto, pro]\n`,
      'utf8',
    );
    const config = resolveAgentConfig({}, tempDir);
    expect(config.customProviders.llmlite).toMatchObject({
      id: 'llmlite',
      baseURL: 'https://llmlite.example.com/v1',
      defaultModel: 'auto',
      models: { type: 'static', list: ['auto', 'pro'] },
    });
  });

  test('invalid providers section fails config resolution', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      `providers:\n  openai:\n    baseURL: https://evil.example.com\n    defaultModel: x\n`,
      'utf8',
    );
    expect(() => resolveAgentConfig({}, tempDir)).toThrow(/collides with built-in/);
  });
});

describe('Custom Providers - definition & discovery', () => {
  const entry = normalizeCustomProviders({
    llmlite: {
      name: 'LLM Lite',
      baseURL: 'https://llmlite.example.com/v1',
      apiKeyEnvVar: 'LLMLITE_TEST_KEY',
      defaultModel: 'auto',
      fallbackModels: ['fallback-1'],
      models: { type: 'static', list: ['auto', { id: 'pro', name: 'Pro Model' }] },
    },
  }).llmlite;

  test('static discovery returns configured models without network', async () => {
    const def = createCustomProviderDefinition('llmlite', entry);
    const models = await def.getModels();
    expect(models).toEqual([
      { id: 'auto', name: 'auto' },
      { id: 'pro', name: 'Pro Model' },
    ]);
  });

  test('resolveApiKey follows explicit > entry apiKey > env var > shared fallback', () => {
    const withLiteral = normalizeCustomProviders({
      p: { ...validEntry, apiKey: 'literal-key', apiKeyEnvVar: 'P_KEY' },
    }).p;
    const def = createCustomProviderDefinition('p', withLiteral);
    process.env.P_KEY = 'env-key';
    try {
      expect(def.resolveApiKey('explicit')).toBe('explicit');
      expect(def.resolveApiKey()).toBe('literal-key');
      const noLiteral = createCustomProviderDefinition(
        'p2',
        normalizeCustomProviders({ p2: { ...validEntry, apiKeyEnvVar: 'P_KEY' } }).p2,
      );
      expect(noLiteral.resolveApiKey()).toBe('env-key');
      delete process.env.P_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      expect(noLiteral.resolveApiKey()).toBe('dummy');
    } finally {
      delete process.env.P_KEY;
    }
  });

  test('createClient targets configured baseURL with default model and fallbacks', () => {
    const def = createCustomProviderDefinition('llmlite', entry);
    const client = def.createClient({ apiKey: 'k' });
    expect(client.providerId).toBe('llmlite');
    expect(client.baseURL).toBe('https://llmlite.example.com/v1');
    expect(client.model).toBe('auto');
    expect(client.apiKey).toBe('k');
  });

  test('endpoint discovery maps response via itemsPath and fields', async () => {
    const server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { items: [{ model: 'm1', label: 'Model One' }, { model: 'm2' }] } }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const endpointEntry = normalizeCustomProviders({
        ep: {
          baseURL: `http://127.0.0.1:${port}/v1`,
          defaultModel: 'auto',
          models: { type: 'endpoint', url: '/api/models', itemsPath: 'data.items', idField: 'model', nameField: 'label' },
        },
      }).ep;
      const def = createCustomProviderDefinition('ep', endpointEntry);
      const models = await def.getModels();
      expect(models).toEqual([
        { id: 'm1', name: 'Model One' },
        { id: 'm2', name: 'm2' },
      ]);
    } finally {
      server.close();
    }
  });

  test('endpoint discovery falls back to default model on failure', async () => {
    const endpointEntry = normalizeCustomProviders({
      ep: {
        baseURL: 'http://127.0.0.1:1/v1',
        defaultModel: 'auto',
        models: { type: 'endpoint', url: '/api/models' },
      },
    }).ep;
    const def = createCustomProviderDefinition('ep', endpointEntry);
    const models = await def.getModels();
    expect(models).toEqual([{ id: 'auto', name: 'auto' }]);
  });

  test('openai-compatible discovery falls back to default when unreachable', async () => {
    const def = createCustomProviderDefinition(
      'llmlite',
      normalizeCustomProviders({ x: { baseURL: 'http://127.0.0.1:1/v1', defaultModel: 'auto' } }).x,
    );
    const models = await def.getModels();
    expect(models).toEqual([{ id: 'auto', name: 'auto' }]);
  });

  test('openai-compatible discovery lists models from /models endpoint', async () => {
    const server = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'model-a' }, { id: 'model-b' }] }));
        return;
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const def = createCustomProviderDefinition(
        'oc',
        normalizeCustomProviders({ oc: { baseURL: `http://127.0.0.1:${port}/v1`, defaultModel: 'auto' } }).oc,
      );
      const models = await def.getModels();
      expect(models.map((m) => m.id)).toEqual(['model-a', 'model-b']);
    } finally {
      server.close();
    }
  });
});

describe('Custom Providers - registry & createProvider', () => {
  const customProviders = normalizeCustomProviders({
    llmlite: { baseURL: 'https://llmlite.example.com/v1', defaultModel: 'auto' },
  });

  test('registerCustomProviders adds customs without overriding built-ins', () => {
    const registry = new ProviderRegistry();
    registerCustomProviders(registry, customProviders);
    expect(registry.has('llmlite')).toBe(true);
    expect(registry.get('llmlite')?.defaultBaseURL).toBe('https://llmlite.example.com/v1');
    expect(registry.get('router')?.id).toBe('router');
  });

  test('createProvider resolves custom provider by ID', () => {
    const provider = createProvider({ provider: 'llmlite', customProviders });
    expect(provider.providerId).toBe('llmlite');
    expect(provider.baseURL).toBe('https://llmlite.example.com/v1');
    expect(provider.model).toBe('auto');
  });

  test('createProvider honors model/baseURL overrides for custom providers', () => {
    const provider = createProvider({
      provider: 'llmlite',
      model: 'pro',
      baseURL: 'https://override.example.com/v1',
      customProviders,
    });
    expect(provider.model).toBe('pro');
    expect(provider.baseURL).toBe('https://override.example.com/v1');
  });

  test('built-in providers still win over custom config', () => {
    const provider = createProvider({ provider: 'openai', apiKey: 'k', customProviders });
    expect(provider.providerId).toBe('openai');
    expect(provider.baseURL).toBe('https://api.openai.com/v1');
  });

  test('unknown provider error lists custom providers', () => {
    expect(() => createProvider({ provider: 'nope', customProviders })).toThrow(/llmlite/);
  });
});
