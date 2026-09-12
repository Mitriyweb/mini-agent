import OpenAI from 'openai';
import concolor from 'concolor';
import type { LLMRequest, Provider, ProviderClientOptions } from './types.js';

const color = (concolor as any)({
  warn: 'b,yellow',
});

const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const RETRY_STATUSES = [429, 503];
const RETRY_MARKERS = ['UNAVAILABLE', 'high demand'];

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryable = (error: any): boolean => {
  if (RETRY_STATUSES.includes(error?.status)) return true;
  const message = error?.message;
  const text = typeof message === 'string' ? message : '';
  return RETRY_MARKERS.some((marker) => text.includes(marker));
};

const unique = (values: (string | undefined | null)[]): string[] => {
  const isString = (value: unknown): value is string => typeof value === 'string' && value !== '';
  const present = values.filter(isString);
  return [...new Set(present)];
};

export const createWithRetry = async (
  client: OpenAI,
  body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
  models: string[],
  log: (message: string) => void,
): Promise<{ response: OpenAI.Chat.ChatCompletion; model: string }> => {
  let lastError: any;

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const nextModel = models[index + 1];
    const request = { ...body, model };

    for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await client.chat.completions.create(request);
        return { response, model };
      } catch (error: any) {
        lastError = error;
        if (!isRetryable(error)) throw error;
        const status = error.status ?? 503;
        const lastAttempt = attempt === RETRY_ATTEMPTS;
        if (nextModel && (lastAttempt || status === 503)) {
          const fromTo = `${model} → ${nextModel}`;
          const notice = `model busy (${status}); switching ${fromTo}`;
          log(color.warn(notice));
          break;
        }
        if (lastAttempt) throw error;
        const wait = RETRY_DELAY_MS * attempt;
        const seconds = wait / 1000;
        const retry = `${attempt}/${RETRY_ATTEMPTS - 1}`;
        const notice = `model busy (${status}); retry ${retry} in ${seconds}s`;
        log(color.warn(notice));
        await delay(wait);
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
  const log = options.log ?? console.log;

  const client = new OpenAI({ apiKey, baseURL, dangerouslyAllowBrowser: true });

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
      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        tool_choice: tools && tools.length > 0 ? 'auto' : undefined,
      };
      const models = unique([model, ...fallbacks]);
      const result = await createWithRetry(client, body, models, log);
      model = result.model;
      return result.response;
    },
  };
};
