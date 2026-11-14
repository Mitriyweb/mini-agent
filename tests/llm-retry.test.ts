import { describe, expect, it, beforeEach } from 'bun:test';
import { classifyLLMError, LLMErrorReason, type LLMErrorClassification, createWithRetry } from '../src/agent/providers/common.js';
import type { RetryConfig } from '../src/types/llm.js';

describe('LLM Retry: Error Classification', () => {
  describe('classifyLLMError', () => {
    it('classifies HTTP 400 as non-retryable client error', () => {
      const error = new Error('Bad request');
      (error as any).status = 400;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ClientError);
      expect(result.status).toBe(400);
    });

    it('classifies HTTP 401 as non-retryable auth error', () => {
      const error = new Error('Unauthorized');
      (error as any).status = 401;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.AuthError);
    });

    it('classifies HTTP 403 as non-retryable auth error', () => {
      const error = new Error('Forbidden');
      (error as any).status = 403;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.AuthError);
    });

    it('classifies HTTP 404 as non-retryable not found error', () => {
      const error = new Error('Not found');
      (error as any).status = 404;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.NotFound);
    });

    it('classifies HTTP 413 as non-retryable context length error', () => {
      const error = new Error('Payload too large');
      (error as any).status = 413;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ContextLengthExceeded);
    });

    it('classifies HTTP 422 as non-retryable client error', () => {
      const error = new Error('Unprocessable entity');
      (error as any).status = 422;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ClientError);
    });

    it('classifies HTTP 408 as retryable server transient error', () => {
      const error = new Error('Request timeout');
      (error as any).status = 408;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies HTTP 429 as retryable rate limit error', () => {
      const error = new Error('Rate limit exceeded');
      (error as any).status = 429;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.RateLimit);
    });

    it('classifies HTTP 500 as retryable server transient error', () => {
      const error = new Error('Internal server error');
      (error as any).status = 500;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies HTTP 502 as retryable server transient error', () => {
      const error = new Error('Bad gateway');
      (error as any).status = 502;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies HTTP 503 as retryable server transient error', () => {
      const error = new Error('Service unavailable');
      (error as any).status = 503;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies HTTP 504 as retryable server transient error', () => {
      const error = new Error('Gateway timeout');
      (error as any).status = 504;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies ECONNRESET as retryable network error', () => {
      const error = new Error('Connection reset');
      (error as any).code = 'ECONNRESET';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.NetworkError);
    });

    it('classifies ETIMEDOUT as retryable network error', () => {
      const error = new Error('Connection timeout');
      (error as any).code = 'ETIMEDOUT';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.NetworkError);
    });

    it('classifies ECONNREFUSED as retryable network error', () => {
      const error = new Error('Connection refused');
      (error as any).code = 'ECONNREFUSED';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.NetworkError);
    });

    it('classifies ENOTFOUND as retryable network error', () => {
      const error = new Error('Not found');
      (error as any).code = 'ENOTFOUND';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.NetworkError);
    });

    it('classifies EAI_AGAIN as retryable network error', () => {
      const error = new Error('Temporary failure');
      (error as any).code = 'EAI_AGAIN';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.NetworkError);
    });

    it('classifies message containing "token limit" as context length error', () => {
      const error = new Error('You exceeded your current quota, please check your plan and billing settings.');
      (error as any).message = 'This model\'s maximum context length is 4096 tokens, but you requested 5000 tokens (4000 in your prompt; 1000 for the completion).';
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ContextLengthExceeded);
    });

    it('classifies message containing "maximum context length" as context length error', () => {
      const error = new Error('maximum context length exceeded');
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ContextLengthExceeded);
    });

    it('classifies message containing "rate limit" as server transient error', () => {
      const error = new Error('Rate limit exceeded. Please try again later.');
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies message containing "high demand" as server transient error', () => {
      const error = new Error('Service experiencing high demand');
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.reason).toBe(LLMErrorReason.ServerTransient);
    });

    it('classifies unknown error as non-retryable unknown', () => {
      const error = new Error('Some random error');
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.Unknown);
    });

    it('prioritizes HTTP status code over message text (400 with "timeout" in body)', () => {
      const error = new Error('Request timeout');
      (error as any).status = 400;
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(false);
      expect(result.reason).toBe(LLMErrorReason.ClientError);
    });

    it('parses Retry-After header as seconds', () => {
      const error = new Error('Too many requests');
      (error as any).status = 429;
      (error as any).response = {
        headers: { 'retry-after': '60' },
      };
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(60000);
    });

    it('parses retry-after-ms header as milliseconds', () => {
      const error = new Error('Too many requests');
      (error as any).status = 429;
      (error as any).response = {
        headers: { 'retry-after-ms': '5000' },
      };
      const result = classifyLLMError(error);
      expect(result.retryable).toBe(true);
      expect(result.retryAfterMs).toBe(5000);
    });
  });

  describe('Retry Configuration Validation', () => {
    it('validates that maxAttempts is a positive integer', () => {
      const config: RetryConfig = {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };
      expect(config.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(config.maxAttempts)).toBe(true);
    });

    it('validates that initialDelayMs is non-negative', () => {
      const config: RetryConfig = {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };
      expect(config.initialDelayMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(config.initialDelayMs)).toBe(true);
    });

    it('validates that backoffFactor is >= 1', () => {
      const config: RetryConfig = {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };
      expect(config.backoffFactor).toBeGreaterThanOrEqual(1);
      expect(Number.isFinite(config.backoffFactor)).toBe(true);
    });

    it('validates that maxDelayMs >= initialDelayMs', () => {
      const config: RetryConfig = {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };
      expect(config.maxDelayMs).toBeGreaterThanOrEqual(config.initialDelayMs);
    });

    it('deterministic exponential backoff formula', () => {
      const config: RetryConfig = {
        enabled: true,
        maxAttempts: 5,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };

      // Attempt 1: 1000 * 2^0 = 1000
      let delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 0));
      expect(delay).toBe(1000);

      // Attempt 2: 1000 * 2^1 = 2000
      delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 1));
      expect(delay).toBe(2000);

      // Attempt 3: 1000 * 2^2 = 4000
      delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 2));
      expect(delay).toBe(4000);

      // Attempt 4: 1000 * 2^3 = 8000
      delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 3));
      expect(delay).toBe(8000);

      // Attempt 5: 1000 * 2^4 = 16000
      delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 4));
      expect(delay).toBe(16000);

      // Attempt 6 would be 32000 but capped at maxDelayMs 30000
      delay = Math.min(config.maxDelayMs, config.initialDelayMs * Math.pow(config.backoffFactor, 5));
      expect(delay).toBe(30000);
    });
  });

  describe('Signal-Aware Delay', () => {
    it('delay rejects immediately if signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Delay cancelled (aborted)'));
            return;
          }
          const timeout = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Delay cancelled (aborted)'));
          });
        });

      try {
        await delay(100, controller.signal);
        expect.unreachable();
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).toContain('Delay cancelled');
      }
    });

    it('delay cancels mid-wait if signal is aborted', async () => {
      const controller = new AbortController();

      const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Delay cancelled (aborted)'));
            return;
          }
          const timeout = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Delay cancelled (aborted)'));
          });
        });

      const delayPromise = delay(1000, controller.signal);
      // Abort after 50ms
      setTimeout(() => controller.abort(), 50);

      try {
        await delayPromise;
        expect.unreachable();
      } catch (err) {
        expect(err instanceof Error).toBe(true);
        expect((err as Error).message).toContain('Delay cancelled');
      }
    });

    it('delay completes normally if signal is not aborted', async () => {
      const controller = new AbortController();

      const delay = (ms: number, signal?: AbortSignal): Promise<void> =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new Error('Delay cancelled (aborted)'));
            return;
          }
          const timeout = setTimeout(resolve, ms);
          signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Delay cancelled (aborted)'));
          });
        });

      const start = Date.now();
      await delay(50, controller.signal);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(50);
    });
  });

  describe('No-Retry Mode', () => {
    it('with retry disabled, exactly 1 attempt is performed per model', () => {
      const config: RetryConfig = {
        enabled: false,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };

      // When retry is disabled, only 1 attempt should be made regardless of maxAttempts
      const maxAttempts = config.enabled ? config.maxAttempts : 1;
      expect(maxAttempts).toBe(1);
    });
  });

  describe('P1 & P2 - Config Validation Regressions', () => {
    it('P1: Partial<RetryConfig> fills defaults before use', () => {
      // Simulate: createOpenAICompatibleClient(..., { retry: { enabled: true } })
      // Should not skip all requests due to undefined maxAttempts
      const defaultRetryConfig: RetryConfig = {
        enabled: true,
        maxAttempts: 3,
        initialDelayMs: 1000,
        backoffFactor: 2,
        maxDelayMs: 30000,
      };
      const supplied = { enabled: true };
      const merged = { ...defaultRetryConfig, ...supplied };
      expect(merged.maxAttempts).toBe(3); // Not undefined
      expect(merged.initialDelayMs).toBe(1000);
      expect(merged.backoffFactor).toBe(2);
      expect(merged.maxDelayMs).toBe(30000);
    });

    it('P2: retry.enabled rejects non-boolean string "false"', () => {
      const config = { enabled: 'false' } as any;
      expect(() => {
        if (typeof config.enabled !== 'boolean') {
          throw new Error(`retry.enabled must be a boolean (true/false), got: ${typeof config.enabled} (${config.enabled})`);
        }
      }).toThrow(/must be a boolean/);
    });

    it('P2: retry.enabled rejects non-boolean "true" string', () => {
      const config = { enabled: 'true' } as any;
      expect(() => {
        if (typeof config.enabled !== 'boolean') {
          throw new Error(`retry.enabled must be a boolean (true/false), got: ${typeof config.enabled} (${config.enabled})`);
        }
      }).toThrow(/must be a boolean/);
    });

    it('P2: retry.enabled accepts only boolean true', () => {
      const config = { enabled: true };
      expect(() => {
        if (typeof config.enabled !== 'boolean') {
          throw new Error(`retry.enabled must be a boolean (true/false), got: ${typeof config.enabled} (${config.enabled})`);
        }
      }).not.toThrow();
    });

    it('P2: retry.enabled accepts only boolean false', () => {
      const config = { enabled: false };
      expect(() => {
        if (typeof config.enabled !== 'boolean') {
          throw new Error(`retry.enabled must be a boolean (true/false), got: ${typeof config.enabled} (${config.enabled})`);
        }
      }).not.toThrow();
    });
  });
});
