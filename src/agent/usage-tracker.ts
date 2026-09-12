export interface ModelPricing {
  input_per_1m_tokens: number;
  output_per_1m_tokens: number;
}

export interface CostTrackingConfig {
  enabled: boolean;
  currency?: string;
  pricing?: ModelPricing;
  models?: Record<string, ModelPricing>;
}

export interface RequestUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  hasPricing: boolean;
  durationMs?: number;
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  currency: string;
  allModelsHavePricing: boolean;
  modelBreakdown: Record<
    string,
    {
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      estimatedCost: number;
      hasPricing: boolean;
    }
  >;
}

export class UsageTracker {
  private config: CostTrackingConfig;
  private requests: RequestUsage[] = [];

  constructor(config: Partial<CostTrackingConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? false,
      currency: config.currency ?? 'USD',
      pricing: config.pricing,
      models: config.models ?? {},
    };
  }

  public isEnabled(): boolean {
    return this.config.enabled;
  }

  public getPricingForModel(modelName: string): ModelPricing | null {
    if (this.config.models && this.config.models[modelName]) {
      return this.config.models[modelName];
    }
    if (this.config.pricing) {
      return this.config.pricing;
    }
    return null;
  }

  public recordRequest(
    model: string,
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; input_tokens?: number; output_tokens?: number },
    durationMs?: number,
  ): RequestUsage {
    const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
    const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
    const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;

    const pricing = this.getPricingForModel(model);
    const hasPricing = pricing !== null;

    let inputCost = 0;
    let outputCost = 0;
    let totalCost = 0;

    if (pricing) {
      inputCost = (inputTokens / 1_000_000) * (pricing.input_per_1m_tokens ?? 0);
      outputCost = (outputTokens / 1_000_000) * (pricing.output_per_1m_tokens ?? 0);
      totalCost = inputCost + outputCost;
    }

    const record: RequestUsage = {
      model,
      inputTokens,
      outputTokens,
      totalTokens,
      inputCost,
      outputCost,
      totalCost,
      hasPricing,
      durationMs,
    };

    if (this.config.enabled) {
      this.requests.push(record);
    }

    return record;
  }

  public getSummary(): UsageSummary {
    const currency = this.config.currency ?? 'USD';
    let requests = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let estimatedCost = 0;
    let allModelsHavePricing = true;

    const modelBreakdown: UsageSummary['modelBreakdown'] = {};

    for (const req of this.requests) {
      requests += 1;
      inputTokens += req.inputTokens;
      outputTokens += req.outputTokens;
      totalTokens += req.totalTokens;
      estimatedCost += req.totalCost;
      if (!req.hasPricing) {
        allModelsHavePricing = false;
      }

      if (!modelBreakdown[req.model]) {
        modelBreakdown[req.model] = {
          requests: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          estimatedCost: 0,
          hasPricing: true,
        };
      }

      const m = modelBreakdown[req.model];
      m.requests += 1;
      m.inputTokens += req.inputTokens;
      m.outputTokens += req.outputTokens;
      m.totalTokens += req.totalTokens;
      m.estimatedCost += req.totalCost;
      if (!req.hasPricing) {
        m.hasPricing = false;
      }
    }

    return {
      requests,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCost,
      currency,
      allModelsHavePricing,
      modelBreakdown,
    };
  }

  public formatSummary(): string {
    const summary = this.getSummary();
    const currencySymbol = summary.currency === 'USD' ? '$' : `${summary.currency} `;

    const formatCost = (cost: number, hasPricing: boolean) => {
      if (!hasPricing && cost === 0) return `${currencySymbol}0.0000 (no pricing info)`;
      return `${currencySymbol}${cost.toFixed(4)}`;
    };

    const lines: string[] = [
      'LLM usage:',
      `  Requests: ${summary.requests.toLocaleString()}`,
      `  Input tokens: ${summary.inputTokens.toLocaleString()}`,
      `  Output tokens: ${summary.outputTokens.toLocaleString()}`,
      `  Total tokens: ${summary.totalTokens.toLocaleString()}`,
      `  Estimated cost: ${formatCost(summary.estimatedCost, summary.allModelsHavePricing)}`,
    ];

    const modelKeys = Object.keys(summary.modelBreakdown);
    if (modelKeys.length > 1) {
      lines.push('  By model:');
      for (const [model, stats] of Object.entries(summary.modelBreakdown)) {
        lines.push(
          `    - ${model}: ${stats.requests} reqs, ${stats.totalTokens.toLocaleString()} tokens, ${formatCost(stats.estimatedCost, stats.hasPricing)}`,
        );
      }
    }

    return lines.join('\n');
  }

  public reset(): void {
    this.requests = [];
  }
}
