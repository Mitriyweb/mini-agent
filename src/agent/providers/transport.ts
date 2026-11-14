import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { Fetch } from 'openai/core';

const gzipAsync = promisify(gzip);

export const providerFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set('accept-encoding', 'gzip');

  const requestInit: RequestInit = {
    ...init,
    headers,
    signal: request.signal,
  };
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();

  if (request.body && contentType === 'application/json') {
    requestInit.body = await gzipAsync(Buffer.from(await request.clone().arrayBuffer()));
    headers.set('content-encoding', 'gzip');
    headers.delete('content-length');
  }

  return fetch(input, requestInit);
};

// OpenAI 4 types node-fetch-specific members; its SDK consumes the standard Fetch contract.
export const openAIProviderFetch = providerFetch as unknown as Fetch;
