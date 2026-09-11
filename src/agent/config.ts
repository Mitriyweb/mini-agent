export interface Config {
  PROVIDER?: string;
  API_KEY?: string;
  MODEL?: string;
  BASE_URL?: string;
  FALLBACK_MODELS?: string[];
}

export const getConfig = (): Config => {
  return {
    PROVIDER: process.env.PROVIDER,
    API_KEY: process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    MODEL: process.env.MODEL,
    BASE_URL: process.env.OPENAI_BASE_URL,
    FALLBACK_MODELS: [],
  };
};
