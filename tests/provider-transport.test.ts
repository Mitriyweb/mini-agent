import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { gunzipSync, gzipSync } from 'node:zlib';
import { defaultProviderRegistry } from '../src/agent/providers/registry.ts';
import { providerFetch } from '../src/agent/providers/transport.ts';

const listen = async (server: Server): Promise<string> => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not bind to a TCP port.');
  }
  return `http://127.0.0.1:${address.port}`;
};

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('providerFetch gzips JSON requests and transparently decodes gzip responses', async () => {
  let contentEncoding: string | undefined;
  let acceptEncoding: string | undefined;
  let decodedRequest: unknown;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    contentEncoding = request.headers['content-encoding'];
    acceptEncoding = request.headers['accept-encoding'];
    decodedRequest = JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8'));

    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    response.end(gzipSync(Buffer.from(JSON.stringify({ ok: true }))));
  });

  const url = await listen(server);
  try {
    const response = await providerFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'compress me' }),
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(contentEncoding).toBe('gzip');
    expect(acceptEncoding).toBe('gzip');
    expect(decodedRequest).toEqual({ prompt: 'compress me' });
  } finally {
    await close(server);
  }
});

test('providerFetch leaves bodyless requests uncompressed and handles identity responses', async () => {
  let contentEncoding: string | undefined;
  let acceptEncoding: string | undefined;
  const server = createServer((request, response) => {
    contentEncoding = request.headers['content-encoding'];
    acceptEncoding = request.headers['accept-encoding'];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ models: [] }));
  });

  const url = await listen(server);
  try {
    const response = await providerFetch(url);
    expect(await response.json()).toEqual({ models: [] });
    expect(contentEncoding).toBeUndefined();
    expect(acceptEncoding).toBe('gzip');
  } finally {
    await close(server);
  }
});

test('built-in completion and SDK model clients use gzip transport', async () => {
  const requests: Array<{
    method: string | undefined;
    contentEncoding: string | undefined;
    acceptEncoding: string | undefined;
    body: Buffer;
  }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }

    const body = Buffer.concat(chunks);
    requests.push({
      method: request.method,
      contentEncoding: request.headers['content-encoding'],
      acceptEncoding: request.headers['accept-encoding'],
      body:
        request.headers['content-encoding'] === 'gzip' ? gunzipSync(body) : body,
    });

    const payload =
      request.method === 'POST'
        ? {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            created: 0,
            model: 'test-model',
            choices: [
              {
                index: 0,
                finish_reason: 'stop',
                message: { role: 'assistant', content: 'ok' },
              },
            ],
          }
        : { data: [{ id: 'test-model', object: 'model', created: 0, owned_by: 'test' }] };
    response.writeHead(200, {
      'content-type': 'application/json',
      'content-encoding': 'gzip',
    });
    response.end(gzipSync(Buffer.from(JSON.stringify(payload))));
  });

  const url = await listen(server);
  try {
    const providers = defaultProviderRegistry.list();
    for (const definition of providers) {
      const client = definition.createClient({
        apiKey: 'test-key',
        baseURL: url,
        model: 'test-model',
        retry: { enabled: false },
      });
      const result = await client.respond({
        messages: [{ role: 'user', content: 'hello' }],
      });
      expect(result.choices[0].message.content).toBe('ok');
    }

    for (const definition of providers) {
      const models = await definition.getModels({ apiKey: 'test-key', baseURL: url });
      expect(models).toEqual([{ id: 'test-model', name: 'test-model' }]);
    }

    const completionRequests = requests.filter((request) => request.method === 'POST');
    const discoveryRequests = requests.filter((request) => request.method === 'GET');
    expect(completionRequests).toHaveLength(providers.length);
    expect(discoveryRequests).toHaveLength(providers.length);
    expect(completionRequests.every((request) => request.contentEncoding === 'gzip')).toBe(true);
    expect(completionRequests.every((request) => request.acceptEncoding === 'gzip')).toBe(true);
    expect(
      completionRequests.every(
        (request) => JSON.parse(request.body.toString('utf8')).messages[0].content === 'hello',
      ),
    ).toBe(true);
    expect(discoveryRequests.every((request) => request.contentEncoding === undefined)).toBe(true);
    expect(discoveryRequests.every((request) => request.acceptEncoding === 'gzip')).toBe(true);
  } finally {
    await close(server);
  }
});
