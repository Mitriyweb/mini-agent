import OpenAI from 'openai';
import concolor from 'concolor';
import type { LLMRequest, Provider, ProviderClientOptions, RetryConfig } from '../../types/llm.ts';
import { validateRetryConfig } from '../config.ts';

const color = (concolor as any)({
  warn: 'b,yellow',
});

// Typed error classification for deterministic retry policies
export enum LLMErrorReason {
  RateLimit = 'rate_limit',
  ServerTransient = 'server_transient',
  NetworkError = 'network_error',
  ClientError = 'client_error',
  ContextLengthExceeded = 'context_length_exceeded',
  AuthError = 'auth_error',
  NotFound = 'not_found',
  Aborted = 'aborted',
  Unknown = 'unknown',
}

export interface LLMErrorClassification {
  retryable: boolean;
  reason: LLMErrorReason;
  status?: number;
  code?: string;
  retryAfterMs?: number;
}

// Network error codes that indicate transient failures
const TRANSIENT_NETWORK_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
];

// HTTP status code to error classification mapping
const STATUS_CODE_MAP: Record<number, { reason: LLMErrorReason; retryable: boolean }> = {
  400: { reason: LLMErrorReason.ClientError, retryable: false },
  401: { reason: LLMErrorReason.AuthError, retryable: false },
  403: { reason: LLMErrorReason.AuthError, retryable: false },
  404: { reason: LLMErrorReason.NotFound, retryable: false },
  408: { reason: LLMErrorReason.ServerTransient, retryable: true },
  413: { reason: LLMErrorReason.ContextLengthExceeded, retryable: false },
  422: { reason: LLMErrorReason.ClientError, retryable: false },
  429: { reason: LLMErrorReason.RateLimit, retryable: true },
  500: { reason: LLMErrorReason.ServerTransient, retryable: true },
  502: { reason: LLMErrorReason.ServerTransient, retryable: true },
  503: { reason: LLMErrorReason.ServerTransient, retryable: true },
  504: { reason: LLMErrorReason.ServerTransient, retryable: true },
  501: { reason: LLMErrorReason.ClientError, retryable: false },
};

const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Delay cancelled (aborted)'));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error('Delay cancelled (aborted)'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Classifies an LLM error as retryable or not, with strict status code precedence.
 * Precedence order:
 * 1. AbortSignal abort or AbortError → aborted
 * 2. Explicit HTTP status codes (via STATUS_CODE_MAP)
 * 3. Network error codes (ECONNRESET, ETIMEDOUT, etc.)
 * 4. Message body pattern matching (only if no status)
 * 5. Default: unknown / not retryable
 */
export const classifyLLMError = (error: unknown): LLMErrorClassification => {
  // Check for abort signal
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { retryable: false, reason: LLMErrorReason.Aborted };
  }

  // Normalize error object
  const err = error as any;

  // Check explicit HTTP status codes (strict precedence)
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (typeof status === 'number' && status in STATUS_CODE_MAP) {
    const classification = STATUS_CODE_MAP[status];
    const retryAfterMs = (classification.retryable) 
      ? parseRetryAfterHeader(err.response?.headers ?? err.headers) 
      : undefined;
    return { retryable: classification.retryable, reason: classification.reason, status, retryAfterMs };
  }

  // Check network error codes (code or cause.code)
  const code = err.code ?? err.cause?.code;
  if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.includes(code)) {
    return { retryable: true, reason: LLMErrorReason.NetworkError, code };
  }

  // Inspect message text only if no status code was present
  if (!status) {
    const message = typeof err.message === 'string' ? err.message : '';
    const text = typeof err.text === 'string' ? err.text : '';
    const body = `${message} ${text}`.toLowerCase();

    if (
      body.includes('context_length_exceeded') ||
      body.includes('token limit') ||
      body.includes('maximum context length') ||
      body.includes('prompt too long')
    ) {
      return { retryable: false, reason: LLMErrorReason.ContextLengthExceeded };
    }

    if (
      body.includes('rate limit') ||
      body.includes('overloaded') ||
      body.includes('high demand') ||
      body.includes('temporarily unavailable')
    ) {
      return { retryable: true, reason: LLMErrorReason.ServerTransient };
    }
  }

  // Default: fail-closed
  return { retryable: false, reason: LLMErrorReason.Unknown };
};

/**
 * Parse Retry-After header from response headers.
 * Supports both HTTP-date format (RFC 7231) and delta-seconds (integer).
 * Returns milliseconds, capped at maxDelayMs if provided.
 */
const parseRetryAfterHeader = (headers?: Record<string, any>): number | undefined => {
  if (!headers) return undefined;

  // Handle both Record and Headers-like objects
  let retryAfterMs: string | undefined;
  let retryAfterSeconds: string | undefined;

  if (typeof headers.get === 'function') {
    // Headers interface
    retryAfterMs = headers.get('retry-after-ms');
    retryAfterSeconds = headers.get('retry-after');
  } else if (typeof headers === 'object') {
    // Record interface
    retryAfterMs = headers['retry-after-ms'];
    retryAfterSeconds = headers['retry-after'];
  }

  // Try parsing milliseconds header first
  if (retryAfterMs) {
    const ms = parseInt(retryAfterMs, 10);
    if (!isNaN(ms) && isFinite(ms) && ms >= 0) {
      return ms;
    }
  }

  // Try parsing seconds header
  if (retryAfterSeconds) {
    const seconds = parseInt(retryAfterSeconds, 10);
    if (!isNaN(seconds) && isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    // Try parsing as HTTP-date (RFC 7231): Wed, 21 Oct 2015 07:28:00 GMT
    try {
      const date = new Date(retryAfterSeconds);
      if (!isNaN(date.getTime())) {
        const delayMs = Math.max(0, date.getTime() - Date.now());
        return delayMs;
      }
    } catch {
      // Ignore parse errors
    }
  }

  return undefined;
};

const unique = (values: (string | undefined | null)[]): string[] => {
  const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
  const present = values.filter(isString);
  return [...new Set(present)];
};

export interface CreateWithRetryOptions {
  delayFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Deterministic retry loop with exponential backoff, Retry-After support, and signal-aware cancellation.
 * Respects RetryConfig boundaries and fails fast on non-transient errors.
 */
export const createWithRetry = async (
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  models: string[],
  retryConfig: RetryConfig,
  signal: AbortSignal | undefined,
  log: (message: string) => void,
  options?: CreateWithRetryOptions,
): Promise<{ response: OpenAI.Chat.ChatCompletion; model: string }> => {
  const delayFn = options?.delayFn ?? delay;
  let lastError: any;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const nextModel = models[modelIndex + 1];
    const request = { ...body, model };

    const maxAttempts = retryConfig.enabled ? retryConfig.maxAttempts : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await client.chat.completions.create(request, { signal });
        return { response, model };
      } catch (error: any) {
        lastError = error;
        const classification = classifyLLMError(error);

        // Fail-fast on non-transient errors
        if (!classification.retryable) {
          throw error;
        }

        const status = classification.status ?? 503;
        const isLastAttempt = attempt === maxAttempts;
        const hasNextModel = !!nextModel;

        // If this is a capacity error and we have a fallback model, try the next one
        if (hasNextModel && (isLastAttempt || status === 503)) {
          const fromTo = `${model} → ${nextModel}`;
          const notice = `model busy (${status}); switching ${fromTo}`;
          log(color.warn(notice));
          break; // Break inner loop to try next model
        }

        // If this is the last attempt, throw
        if (isLastAttempt) {
          throw error;
        }

        // Calculate backoff delay
        let delayMs = classification.retryAfterMs;
        if (delayMs === undefined) {
          // Deterministic exponential backoff without jitter
          delayMs = Math.min(
            retryConfig.maxDelayMs,
            retryConfig.initialDelayMs * Math.pow(retryConfig.backoffFactor, attempt - 1),
          );
        } else {
          // Respect Retry-After but cap at maxDelayMs
          delayMs = Math.min(retryConfig.maxDelayMs, delayMs);
        }

        const seconds = (delayMs / 1000).toFixed(1);
        const attemptStr = `${attempt}/${maxAttempts - 1}`;
        const notice = `transient error (${status}); retry ${attemptStr} in ${seconds}s`;
        log(color.warn(notice));

        // Delay with signal awareness
        await delayFn(delayMs, signal);
      }
    }
  }

  throw lastError ?? new Error('Model request failed after retries.');
};

export const createOpenAICompatibleClient = (
  providerId: string,
  apiKey: string,
  baseURL: string,
  initialModel: string,
  options: ProviderClientOptions = {},
): Provider => {
  let model = initialModel;
  const fallbacks = options.fallbacks ?? [];
  
  // Merge supplied retry config with defaults and validate
  const defaultRetryConfig: RetryConfig = {
    enabled: true,
    maxAttempts: 3,
    initialDelayMs: 1000,
    backoffFactor: 2,
    maxDelayMs: 30000,
  };
  const retryCandidate = { ...defaultRetryConfig, ...options.retry };
  
  // Validate supplied config (only validates provided fields)
  if (options.retry) {
    validateRetryConfig(options.retry);
  }
  
  const retryConfig: RetryConfig = {
    enabled: retryCandidate.enabled,
    maxAttempts: retryCandidate.maxAttempts,
    initialDelayMs: retryCandidate.initialDelayMs,
    backoffFactor: retryCandidate.backoffFactor,
    maxDelayMs: retryCandidate.maxDelayMs,
  };
  
  const delayFn = options.delayFn;
  const log = options.log ?? console.log;

  // Disable SDK internal retries; we handle retries deterministically
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, dangerouslyAllowBrowser: true });

  return {
    get providerId() {
      return providerId;
    },
    get model() {
      return model;
    },
    get baseURL() {
      return baseURL;
    },
    get apiKey() {
      return apiKey;
    },
    async respond(request: LLMRequest) {
      const messages = request.messages;
      const tools = request.tools;
      const signal = request.signal;
      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      };
      const models = unique([model, ...fallbacks]);
      const result = await createWithRetry(client, body, models, retryConfig, signal, log, {
        delayFn,
      });
      model = result.model;
      return result.response;
    },
  };
};
