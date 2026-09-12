import { describe, expect, it } from 'bun:test';
import { UsageTracker } from '../src/agent/usage-tracker.js';

describe('Cost Tracking & LLM Usage Accounting Test Suite', () => {
  it('does not record usage when disabled', () => {
    const tracker = new UsageTracker({ enabled: false });
    tracker.recordRequest('model-a', { prompt_tokens: 100, completion_tokens: 50 });

    const summary = tracker.getSummary();
    expect(summary.requests).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.estimatedCost).toBe(0);
  });

  it('tracks token usage correctly when enabled', () => {
    const tracker = new UsageTracker({ enabled: true });
    tracker.recordRequest('model-a', { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 });

    const summary = tracker.getSummary();
    expect(summary.requests).toBe(1);
    expect(summary.inputTokens).toBe(1000);
    expect(summary.outputTokens).toBe(500);
    expect(summary.totalTokens).toBe(1500);
  });

  it('calculates cost using model-specific pricing', () => {
    const tracker = new UsageTracker({
      enabled: true,
      currency: 'USD',
      models: {
        'gpt-4o': {
          input_per_1m_tokens: 2.5,  // $2.50 per 1M tokens ($0.0025 / 1k)
          output_per_1m_tokens: 10.0, // $10.00 per 1M tokens ($0.010 / 1k)
        },
      },
    });

    // 1,000,000 input tokens = $2.50, 500,000 output tokens = $5.00 => Total = $7.50
    tracker.recordRequest('gpt-4o', { prompt_tokens: 1_000_000, completion_tokens: 500_000 });

    const summary = tracker.getSummary();
    expect(summary.estimatedCost).toBeCloseTo(7.5, 4);
  });

  it('calculates cost using fallback top-level pricing if model pricing is not specified', () => {
    const tracker = new UsageTracker({
      enabled: true,
      currency: 'USD',
      pricing: {
        input_per_1m_tokens: 1.0,
        output_per_1m_tokens: 3.0,
      },
    });

    tracker.recordRequest('unknown-model', { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });

    const summary = tracker.getSummary();
    expect(summary.estimatedCost).toBeCloseTo(4.0, 4);
  });

  it('handles missing pricing gracefully without crashing', () => {
    const tracker = new UsageTracker({ enabled: true, currency: 'USD' });

    tracker.recordRequest('custom-model-no-price', { prompt_tokens: 5000, completion_tokens: 2000 });

    const summary = tracker.getSummary();
    expect(summary.requests).toBe(1);
    expect(summary.totalTokens).toBe(7000);
    expect(summary.estimatedCost).toBe(0);
    expect(summary.allModelsHavePricing).toBe(false);
    expect(tracker.formatSummary()).toContain('no pricing info');
  });

  it('aggregates multiple requests across multiple models', () => {
    const tracker = new UsageTracker({
      enabled: true,
      currency: 'USD',
      models: {
        'model-a': { input_per_1m_tokens: 1.0, output_per_1m_tokens: 2.0 },
        'model-b': { input_per_1m_tokens: 2.0, output_per_1m_tokens: 4.0 },
      },
    });

    tracker.recordRequest('model-a', { prompt_tokens: 100_000, completion_tokens: 50_000 });
    tracker.recordRequest('model-b', { prompt_tokens: 200_000, completion_tokens: 100_000 });

    const summary = tracker.getSummary();
    expect(summary.requests).toBe(2);
    expect(summary.totalTokens).toBe(450_000);
    expect(Object.keys(summary.modelBreakdown).length).toBe(2);

    const formatted = tracker.formatSummary();
    expect(formatted).toContain('LLM usage:');
    expect(formatted).toContain('By model:');
    expect(formatted).toContain('model-a');
    expect(formatted).toContain('model-b');
  });
});
