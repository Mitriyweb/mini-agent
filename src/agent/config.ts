import fs from 'node:fs';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import type { LogLevel, LoggingConfig } from './logging.ts';
import type { CostTrackingConfig, ModelPricing } from './usage-tracker.ts';
import type { SkillsConfig } from './skills.ts';
import type { SystemPromptConfig } from './system-prompt.ts';

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

export interface FileConfigSchema {
  logging?: {
    level?: LogLevel;
    filePath?: string;
  };
  cost_tracking?: {
    enabled?: boolean;
    currency?: string;
    pricing?: ModelPricing;
    models?: Record<string, ModelPricing>;
  };
  costTracking?: {
    enabled?: boolean;
    currency?: string;
    pricing?: ModelPricing;
    models?: Record<string, ModelPricing>;
  };
  skills?: {
    enabled?: boolean;
    allow?: string[];
    deny?: string[];
  };
  system_prompt?: {
    enabled?: boolean;
    path?: string;
  };
  systemPrompt?: {
    enabled?: boolean;
    path?: string;
  };
  provider?: string;
  model?: string;
  url?: string;
  baseURL?: string;
  max_steps?: number;
  maxSteps?: number;
  auto_approve?: boolean;
  autoApprove?: boolean;
}

export interface PartialAgentConfig {
  logging?: Partial<LoggingConfig>;
  costTracking?: Partial<CostTrackingConfig>;
  skills?: Partial<SkillsConfig>;
  systemPrompt?: Partial<SystemPromptConfig>;
  provider?: string;
  model?: string;
  baseURL?: string;
  maxSteps?: number;
  autoApprove?: boolean;
  configPath?: string;
}

export interface AgentResolvedConfig {
  logging: LoggingConfig;
  costTracking: CostTrackingConfig;
  skills: SkillsConfig;
  systemPrompt: SystemPromptConfig;
  provider?: string;
  model?: string;
  baseURL?: string;
  maxSteps?: number;
  autoApprove?: boolean;
}

const CONFIG_FILE_NAMES = [
  'mini-agent.config.yaml',
  'mini-agent.config.yml',
  'mini-agent.config.json',
  '.mini-agentrc.yaml',
  '.mini-agentrc.yml',
  '.mini-agentrc.json',
];

export const loadConfigFile = (workspaceRoot?: string, explicitPath?: string): FileConfigSchema => {
  const root = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();

  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : CONFIG_FILE_NAMES.map((name) => path.join(root, name));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        if (candidate.endsWith('.json')) {
          return JSON.parse(raw) as FileConfigSchema;
        }
        return (parseYaml(raw) as FileConfigSchema) || {};
      } catch (err) {
        if (explicitPath) {
          throw new Error(`Failed to parse configuration file at '${candidate}': ${err}`);
        }
      }
    }
  }

  return {};
};

export const resolveAgentConfig = (
  cliOverrides: PartialAgentConfig = {},
  workspaceRoot?: string,
): AgentResolvedConfig => {
  const fileConfig = loadConfigFile(workspaceRoot, cliOverrides.configPath);

  // Defaults
  const defaultLogging: LoggingConfig = { level: 'normal', filePath: path.join(process.cwd(), 'mini-agent.log') };
  const defaultCostTracking: CostTrackingConfig = { enabled: false, currency: 'USD', models: {} };
  const defaultSkills: SkillsConfig = { enabled: true, allow: [], deny: [] };
  const defaultSystemPrompt: SystemPromptConfig = { enabled: true };

  // File values
  const fileLogging = fileConfig.logging;
  const envLogFile = (process.env.MINI_AGENT_LOG_FILE || process.env.LOG_FILE) as string | undefined;
  const fileCost = fileConfig.cost_tracking ?? fileConfig.costTracking;
  const fileSkills = fileConfig.skills;
  const fileSysPrompt = fileConfig.system_prompt ?? fileConfig.systemPrompt;

  // Environment variable overrides
  const envLogLevel = (process.env.MINI_AGENT_LOG_LEVEL || process.env.LOG_LEVEL) as LogLevel | undefined;
  const envCostTracking = process.env.MINI_AGENT_COST_TRACKING !== undefined
    ? process.env.MINI_AGENT_COST_TRACKING === 'true'
    : undefined;
  const envSkillsEnabled = process.env.MINI_AGENT_SKILLS_ENABLED !== undefined
    ? process.env.MINI_AGENT_SKILLS_ENABLED === 'true'
    : undefined;
  const envSystemPromptEnabled = process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED !== undefined
    ? process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED === 'true'
    : undefined;

  // Merge Logging (Defaults < Config File < Env < CLI)
  const level: LogLevel =
    cliOverrides.logging?.level ??
    envLogLevel ??
    fileLogging?.level ??
    defaultLogging.level;

  const filePath: string | undefined =
    cliOverrides.logging?.filePath ??
    envLogFile ??
    fileLogging?.filePath ??
    (level === 'off' ? undefined : defaultLogging.filePath);

  // Merge Cost Tracking
  const costEnabled: boolean =
    cliOverrides.costTracking?.enabled ??
    envCostTracking ??
    fileCost?.enabled ??
    defaultCostTracking.enabled;

  const costCurrency: string =
    cliOverrides.costTracking?.currency ??
    fileCost?.currency ??
    defaultCostTracking.currency ??
    'USD';

  const costPricing = cliOverrides.costTracking?.pricing ?? fileCost?.pricing;
  const costModels = { ...(fileCost?.models ?? {}), ...(cliOverrides.costTracking?.models ?? {}) };

  // Merge Skills
  const skillsEnabled: boolean =
    cliOverrides.skills?.enabled ??
    envSkillsEnabled ??
    fileSkills?.enabled ??
    defaultSkills.enabled;

  const skillsAllow = cliOverrides.skills?.allow ?? fileSkills?.allow ?? defaultSkills.allow;
  const skillsDeny = cliOverrides.skills?.deny ?? fileSkills?.deny ?? defaultSkills.deny;

  // Merge System Prompt
  const sysPromptEnabled: boolean =
    cliOverrides.systemPrompt?.enabled ??
    envSystemPromptEnabled ??
    fileSysPrompt?.enabled ??
    defaultSystemPrompt.enabled;

  const sysPromptPath = cliOverrides.systemPrompt?.path ?? fileSysPrompt?.path;

  // Standard settings
  const provider =
    cliOverrides.provider ??
    process.env.PROVIDER ??
    fileConfig.provider ??
    process.env.PROVIDER;

  const model =
    cliOverrides.model ??
    process.env.MODEL ??
    fileConfig.model;

  const baseURL =
    cliOverrides.baseURL ??
    process.env.OPENAI_BASE_URL ??
    fileConfig.baseURL ??
    fileConfig.url;

  const maxSteps =
    cliOverrides.maxSteps ??
    fileConfig.maxSteps ??
    fileConfig.max_steps;

  const autoApprove =
    cliOverrides.autoApprove ??
    (process.env.AUTO_APPROVE === 'true' ? true : undefined) ??
    fileConfig.autoApprove ??
    fileConfig.auto_approve;

  return {
    logging: { level, filePath },
    costTracking: {
      enabled: costEnabled,
      currency: costCurrency,
      pricing: costPricing,
      models: costModels,
    },
    skills: {
      enabled: skillsEnabled,
      allow: skillsAllow,
      deny: skillsDeny,
    },
    systemPrompt: {
      enabled: sysPromptEnabled,
      path: sysPromptPath,
    },
    provider,
    model,
    baseURL,
    maxSteps,
    autoApprove,
  };
};
