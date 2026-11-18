import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dump } from 'js-yaml';

import {
  DEFAULT_RETRY_CONFIG,
  loadConfigFile,
  normalizePermissionMode,
  resolveAgentConfig,
  resolveUserConfigDir,
  validateReviewConfig,
  type FileConfigSchema,
} from './config.ts';
import { DEFAULT_SUBAGENTS_CONFIG } from './subagents.ts';
import { normalizeCustomProviders } from './providers/custom-config.ts';
import { normalizeQualityGatesConfig } from './quality-gates.ts';

export type ConfigWizardFormat = 'yaml' | 'json';
export type ConfigWizardScope = 'user' | 'workspace';

export interface ConfigWizardAsk {
  (prompt: string): Promise<string>;
}

export interface ConfigWizardOptions {
  workspaceDir: string;
  /** Config scope to write. Interactive runs prompt for it; defaults to 'user'. */
  scope?: ConfigWizardScope;
  /** Explicit output target (from --config). Overrides `scope` when set. */
  targetPath?: string;
  format?: ConfigWizardFormat;
  /** Print the fully commented defaults template without prompting or writing. */
  defaultsOnly?: boolean;
  /** Generate content but never write it. */
  dryRun?: boolean;
  /** Overwrite an existing target without confirmation. */
  force?: boolean;
  ask?: ConfigWizardAsk;
  log?: (message: string) => void;
}

export interface ConfigWizardResult {
  /** Absolute path that was written, or would be written. */
  path: string;
  format: ConfigWizardFormat;
  /** Serialized config content (also printed on dry-run/defaults). */
  content: string;
  wrote: boolean;
  /** True when the user declined to overwrite an existing file. */
  aborted?: boolean;
}

type Draft = Record<string, any>;

type FieldKind = 'bool' | 'enum' | 'permission' | 'string' | 'number' | 'int' | 'list' | 'json';

export interface WizardField {
  section: string;
  label: string;
  path: Array<string | number>;
  kind: FieldKind;
  choices?: string[];
  hint?: string;
  validate?: (value: unknown) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getPath = (obj: Draft, path: Array<string | number>): unknown => {
  let cur: any = obj;
  for (const key of path) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[key];
  }
  return cur;
};

const setPath = (obj: Draft, path: Array<string | number>, value: unknown): void => {
  let cur: any = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') {
      cur[key] = typeof path[i + 1] === 'number' ? [] : {};
    }
    cur = cur[key];
  }
  const last = path[path.length - 1];
  if (value === undefined || value === null) {
    delete cur[last];
  } else {
    cur[last] = value;
  }
};

const deepClone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(deepClone);
  if (isRecord(value)) {
    const out: Draft = {};
    for (const [key, v] of Object.entries(value)) out[key] = deepClone(v);
    return out;
  }
  return value;
};

const deepMerge = (base: Draft, override: Draft): Draft => {
  const result: Draft = deepClone(base) as Draft;
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Draft, value);
    } else {
      result[key] = deepClone(value);
    }
  }
  return result;
};

const stripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (isRecord(value)) {
    const out: Draft = {};
    for (const [key, v] of Object.entries(value)) {
      if (v !== undefined) out[key] = stripUndefined(v);
    }
    return out;
  }
  return value;
};

/**
 * Wizard-level defaults. These intentionally differ from the runtime defaults
 * where the wizard offers a safer posture (logging off). Everything else
 * mirrors the documented defaults so the generated file is self-contained.
 */
export const WIZARD_DEFAULT_FILE_CONFIG: FileConfigSchema = {
  logging: { level: 'off' },
  audit: { enabled: true },
  cost_tracking: { enabled: false, currency: 'USD' },
  skills: { enabled: true, allow: [], deny: [] },
  system_prompt: { enabled: true },
  provider: undefined,
  model: undefined,
  baseURL: undefined,
  max_steps: undefined,
  auto_approve: undefined,
  permission_mode: 'normal',
  retry: { ...DEFAULT_RETRY_CONFIG },
  external_review: { enabled: false },
  subagents: {
    enabled: DEFAULT_SUBAGENTS_CONFIG.enabled,
    max_concurrency: DEFAULT_SUBAGENTS_CONFIG.maxConcurrency,
    max_steps: DEFAULT_SUBAGENTS_CONFIG.maxSteps,
    allow_nested: DEFAULT_SUBAGENTS_CONFIG.allowNested,
  },
  quality_gates: { enabled: false, gates: [] },
  providers: {},
};

const TOP_LEVEL_ORDER = [
  'logging',
  'audit',
  'cost_tracking',
  'skills',
  'system_prompt',
  'provider',
  'model',
  'baseURL',
  'max_steps',
  'auto_approve',
  'permission_mode',
  'retry',
  'external_review',
  'subagents',
  'quality_gates',
  'providers',
];

const SECTION_COMMENTS: Record<string, string> = {
  logging: 'Log output level and optional file sink',
  audit: 'Audit trail under .mini-agent (independent of logging.level)',
  cost_tracking: 'LLM token usage and cost tracking',
  skills: 'Skill loading allow/deny lists',
  system_prompt: 'Built-in system prompt toggle and custom path',
  provider: 'LLM provider id (built-in or a custom providers: id)',
  model: 'Model id for the selected provider',
  baseURL: 'OpenAI-compatible base URL override',
  max_steps: 'Max agent steps per run',
  auto_approve: 'Auto-approve tool calls without prompting',
  permission_mode: 'normal prompts for sensitive calls; bypass auto-approves and skips quality gates',
  retry: 'Retry policy for transient LLM errors',
  external_review: 'External review integration (opt-in)',
  subagents: 'Child-agent delegation (opt-in)',
  quality_gates: 'Checks run after agent tasks',
  providers: 'Custom OpenAI-compatible provider endpoints',
};

const FIELD_COMMENTS: Record<string, string> = {
  'logging.level': 'off | normal | verbose',
  'logging.filePath': 'optional log file path (default: ./mini-agent.log)',
  'audit.enabled': 'record tool calls and run lifecycle events (not affected by logging.level)',
  'audit.filePath': 'optional audit file path (default: .mini-agent/audit.jsonl)',
  'cost_tracking.enabled': 'track token usage and cost per request',
  'cost_tracking.currency': 'currency code for cost estimates',
  'cost_tracking.pricing': 'default pricing per 1M tokens: {"input_per_1m_tokens":0,"output_per_1m_tokens":0}',
  'cost_tracking.models': 'per-model pricing overrides: {"model-id":{"input_per_1m_tokens":0,"output_per_1m_tokens":0}}',
  'skills.enabled': 'load and inject skills into the system prompt',
  'skills.allow': 'comma-separated skill allow list (empty = all)',
  'skills.deny': 'comma-separated skill deny list',
  'system_prompt.enabled': 'include the built-in system prompt',
  'system_prompt.path': 'optional custom system prompt file path',
  'permission_mode': 'normal | bypass (aliases: yolo, dangerous)',
  'retry.enabled': 'retry transient LLM errors',
  'retry.maxAttempts': 'max retry attempts',
  'retry.initialDelayMs': 'initial backoff delay in ms',
  'retry.backoffFactor': 'exponential backoff multiplier',
  'retry.maxDelayMs': 'max delay between retries in ms',
  'external_review.enabled': 'enable external review for the run',
  'external_review.authorized_provider': 'optional provider id allowed to run reviews',
  'external_review.retries': 'review retry overrides: {"maxAttempts":3,"initialDelayMs":1000,"backoffFactor":2}',
  'subagents.enabled': 'enable the delegate tool for child agents',
  'subagents.max_concurrency': 'max concurrent child tasks per delegate call',
  'subagents.max_steps': 'default per-child step limit',
  'subagents.allow_nested': 'allow write-capable children to delegate further',
  'quality_gates.enabled': 'run configured gates after agent tasks',
  'quality_gates.gates': 'gate array: [{"id":"lint","command":"bun run lint","required":true,"timeout_ms":120000}]',
  'providers': 'provider map: {"id":{"baseURL":"https://.../v1","defaultModel":"...","apiKeyEnvVar":"..."}}',
};

const validatePricing = (value: unknown): void => {
  if (!isRecord(value)) throw new Error('expected an object');
  for (const key of ['input_per_1m_tokens', 'output_per_1m_tokens'] as const) {
    const v = value[key];
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0)) {
      throw new Error(`'${key}' must be a non-negative number`);
    }
  }
};

const validatePricingMap = (value: unknown): void => {
  if (!isRecord(value)) throw new Error('expected an object mapping model ids to pricing');
  for (const [model, pricing] of Object.entries(value)) {
    try {
      validatePricing(pricing);
    } catch (err) {
      throw new Error(`model '${model}': ${(err as Error).message}`);
    }
  }
};

const validateReviewRetries = (value: unknown): void => {
  validateReviewConfig({ enabled: false, retries: value as any });
};

export const WIZARD_FIELDS: WizardField[] = [
  // logging
  { section: 'Logging', label: 'logging.level', path: ['logging', 'level'], kind: 'enum', choices: ['off', 'normal', 'verbose'] },
  { section: 'Logging', label: 'logging.filePath', path: ['logging', 'filePath'], kind: 'string', hint: 'empty keeps default (./mini-agent.log)' },
  // audit
  { section: 'Audit', label: 'audit.enabled', path: ['audit', 'enabled'], kind: 'bool' },
  { section: 'Audit', label: 'audit.filePath', path: ['audit', 'filePath'], kind: 'string', hint: 'empty keeps default (.mini-agent/audit.jsonl)' },
  // cost_tracking
  { section: 'Cost Tracking', label: 'cost_tracking.enabled', path: ['cost_tracking', 'enabled'], kind: 'bool' },
  { section: 'Cost Tracking', label: 'cost_tracking.currency', path: ['cost_tracking', 'currency'], kind: 'string' },
  { section: 'Cost Tracking', label: 'cost_tracking.pricing', path: ['cost_tracking', 'pricing'], kind: 'json', hint: '{"input_per_1m_tokens":0,"output_per_1m_tokens":0}', validate: validatePricing },
  { section: 'Cost Tracking', label: 'cost_tracking.models', path: ['cost_tracking', 'models'], kind: 'json', hint: '{"model-id":{"input_per_1m_tokens":0,"output_per_1m_tokens":0}}', validate: validatePricingMap },
  // skills
  { section: 'Skills', label: 'skills.enabled', path: ['skills', 'enabled'], kind: 'bool' },
  { section: 'Skills', label: 'skills.allow', path: ['skills', 'allow'], kind: 'list', hint: 'comma-separated, empty keeps current' },
  { section: 'Skills', label: 'skills.deny', path: ['skills', 'deny'], kind: 'list', hint: 'comma-separated, empty keeps current' },
  // system_prompt
  { section: 'System Prompt', label: 'system_prompt.enabled', path: ['system_prompt', 'enabled'], kind: 'bool' },
  { section: 'System Prompt', label: 'system_prompt.path', path: ['system_prompt', 'path'], kind: 'string', hint: 'empty disables custom path' },
  // top-level
  { section: 'Provider', label: 'provider', path: ['provider'], kind: 'string', hint: 'empty keeps unset' },
  { section: 'Provider', label: 'model', path: ['model'], kind: 'string', hint: 'empty keeps unset' },
  { section: 'Provider', label: 'baseURL', path: ['baseURL'], kind: 'string', hint: 'empty keeps unset' },
  { section: 'Runtime', label: 'max_steps', path: ['max_steps'], kind: 'int', hint: 'empty keeps unset' },
  { section: 'Runtime', label: 'auto_approve', path: ['auto_approve'], kind: 'bool', hint: 'empty keeps unset' },
  { section: 'Permissions', label: 'permission_mode', path: ['permission_mode'], kind: 'permission', choices: ['normal', 'bypass'] },
  // retry
  { section: 'Retry', label: 'retry.enabled', path: ['retry', 'enabled'], kind: 'bool' },
  { section: 'Retry', label: 'retry.maxAttempts', path: ['retry', 'maxAttempts'], kind: 'int' },
  { section: 'Retry', label: 'retry.initialDelayMs', path: ['retry', 'initialDelayMs'], kind: 'int' },
  { section: 'Retry', label: 'retry.backoffFactor', path: ['retry', 'backoffFactor'], kind: 'number' },
  { section: 'Retry', label: 'retry.maxDelayMs', path: ['retry', 'maxDelayMs'], kind: 'int' },
  // external_review
  { section: 'External Review', label: 'external_review.enabled', path: ['external_review', 'enabled'], kind: 'bool' },
  { section: 'External Review', label: 'external_review.authorized_provider', path: ['external_review', 'authorized_provider'], kind: 'string', hint: 'empty keeps unset' },
  { section: 'External Review', label: 'external_review.retries', path: ['external_review', 'retries'], kind: 'json', hint: '{"maxAttempts":3,"initialDelayMs":1000,"backoffFactor":2}', validate: validateReviewRetries },
  // subagents
  { section: 'Subagents', label: 'subagents.enabled', path: ['subagents', 'enabled'], kind: 'bool' },
  { section: 'Subagents', label: 'subagents.max_concurrency', path: ['subagents', 'max_concurrency'], kind: 'int' },
  { section: 'Subagents', label: 'subagents.max_steps', path: ['subagents', 'max_steps'], kind: 'int' },
  { section: 'Subagents', label: 'subagents.allow_nested', path: ['subagents', 'allow_nested'], kind: 'bool' },
  // quality_gates
  { section: 'Quality Gates', label: 'quality_gates.enabled', path: ['quality_gates', 'enabled'], kind: 'bool' },
  { section: 'Quality Gates', label: 'quality_gates.gates', path: ['quality_gates', 'gates'], kind: 'json', hint: '[{"id":"lint","command":"bun run lint","required":true}]', validate: (v) => normalizeQualityGatesConfig({ enabled: true, gates: v }) },
  // providers
  { section: 'Providers', label: 'providers', path: ['providers'], kind: 'json', hint: '{"id":{"baseURL":"https://.../v1","defaultModel":"...","apiKeyEnvVar":"ENV_VAR"}}', validate: (v) => normalizeCustomProviders(v) },
];

const formatCurrent = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
};

const parseBool = (raw: string): boolean => {
  const v = raw.trim().toLowerCase();
  if (['y', 'yes', 'true', '1', 'on'].includes(v)) return true;
  if (['n', 'no', 'false', '0', 'off'].includes(v)) return false;
  throw new Error(`expected yes/no, got '${raw}'`);
};

const parseFieldValue = (field: WizardField, raw: string): unknown => {
  const input = raw.trim();
  switch (field.kind) {
    case 'bool':
      return parseBool(input);
    case 'enum': {
      const v = input.toLowerCase();
      if (!field.choices?.includes(v)) {
        throw new Error(`expected one of: ${field.choices?.join(', ')}`);
      }
      return v;
    }
    case 'permission': {
      try {
        return String(normalizePermissionMode(input));
      } catch {
        throw new Error(`expected normal or bypass (aliases: yolo, dangerous)`);
      }
    }
    case 'string':
      return input;
    case 'int': {
      const n = Number(input);
      if (!Number.isInteger(n)) throw new Error('expected an integer');
      return n;
    }
    case 'number': {
      const n = Number(input);
      if (!Number.isFinite(n)) throw new Error('expected a number');
      return n;
    }
    case 'list':
      return input.split(',').map((s) => s.trim()).filter(Boolean);
    case 'json': {
      const parsed = JSON.parse(input);
      if (field.validate) field.validate(parsed);
      return parsed;
    }
  }
};

const OPTIONAL_TOP_LEVEL_HINTS = ['provider', 'model', 'baseURL', 'max_steps', 'auto_approve'];

const orderDraft = (draft: Draft): Draft => {
  const out: Draft = {};
  for (const key of TOP_LEVEL_ORDER) {
    if (draft[key] !== undefined) out[key] = draft[key];
  }
  for (const [key, value] of Object.entries(draft)) {
    if (!(key in out) && value !== undefined) out[key] = value;
  }
  return out;
};

const injectComments = (yamlText: string): string => {
  const lines = yamlText.split('\n');
  let section = '';
  const out: string[] = [];
  for (const line of lines) {
    const topMatch = line.match(/^([A-Za-z_][\w]*):/);
    if (topMatch) {
      section = topMatch[1];
      const comment = SECTION_COMMENTS[section];
      if (comment && !line.includes('#')) out.push(`${line}  # ${comment}`);
      else out.push(line);
      continue;
    }
    const nestedMatch = line.match(/^(\s+)([A-Za-z_][\w]*):/);
    if (nestedMatch && section) {
      const key = `${section}.${nestedMatch[2]}`;
      const comment = FIELD_COMMENTS[key];
      if (comment && !line.includes('#')) {
        out.push(`${line}  # ${comment}`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join('\n');
};

const serializeConfig = (draft: Draft, format: ConfigWizardFormat): string => {
  const ordered = orderDraft(stripUndefined(draft) as Draft);
  if (format === 'json') {
    return `${JSON.stringify(ordered, null, 2)}\n`;
  }
  const yamlText = dump(ordered, { lineWidth: -1, noRefs: true });
  let text = injectComments(yamlText);
  const missing = OPTIONAL_TOP_LEVEL_HINTS.filter((key) => ordered[key] === undefined);
  if (missing.length > 0) {
    text += `\n# Optional top-level overrides (uncomment to set):\n${missing
      .map((key) => `# ${key}: ${key === 'baseURL' ? '""' : key === 'max_steps' ? '30' : key === 'auto_approve' ? 'false' : 'router'}`)
      .join('\n')}\n`;
  }
  return text;
};

/**
 * Round-trip validation: serialize the draft, load it back through the real
 * config pipeline in a temp workspace, and return any resolution error.
 */
const assertConfigLoads = (content: string, format: ConfigWizardFormat, workspaceDir: string): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-config-'));
  try {
    const fileName = format === 'json' ? 'mini-agent.config.json' : 'mini-agent.config.yaml';
    fs.writeFileSync(path.join(dir, fileName), content);
    resolveAgentConfig({ configPath: fileName }, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

const loadExistingDraft = (targetPath: string, workspaceDir: string, warn: (m: string) => void): Draft => {
  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) return {};
  try {
    return loadConfigFile(workspaceDir, targetPath) as Draft;
  } catch (err) {
    warn(`Could not parse existing config at ${targetPath}: ${(err as Error).message}. Starting from defaults.`);
    return {};
  }
};

const promptField = async (
  field: WizardField,
  draft: Draft,
  ask: ConfigWizardAsk,
  log: (m: string) => void,
): Promise<void> => {
  const current = getPath(draft, field.path);
  const choices = field.choices ? ` (${field.choices.join('|')})` : '';
  const currentText = formatCurrent(current);
  const prompt = `${field.label}${choices}${currentText !== '' ? ` [${currentText}]` : ''}: `;

  for (;;) {
    const raw = await ask(prompt);
    if (raw.trim() === '') return; // keep current
    try {
      const value = parseFieldValue(field, raw);
      setPath(draft, field.path, value);
      return;
    } catch (err) {
      log(`  ! ${(err as Error).message}`);
    }
  }
};

const promptScope = async (
  ask: ConfigWizardAsk,
  log: (m: string) => void,
  workspaceDir: string,
): Promise<ConfigWizardScope> => {
  const userDir = resolveUserConfigDir();
  for (;;) {
    const answer = await ask(
      `Config scope:\n  1) user-level (${userDir})\n  2) workspace (${workspaceDir})\nScope [1]: `,
    );
    const value = answer.trim().toLowerCase();
    if (value === '' || value === '1' || value === 'user' || value === 'u') return 'user';
    if (value === '2' || value === 'workspace' || value === 'w') return 'workspace';
    log('  ! expected 1 (user-level) or 2 (workspace)');
  }
};

export const runConfigWizard = async (options: ConfigWizardOptions): Promise<ConfigWizardResult> => {
  const workspaceDir = path.resolve(options.workspaceDir || process.cwd());
  const log = options.log ?? ((m: string) => console.log(m));
  const warn = (m: string) => console.error(m);
  const ask =
    options.ask ??
    (() => {
      throw new Error('An interactive prompt function is required for the config wizard.');
    });

  // Explicit --config targets win. Otherwise the interactive wizard asks for a
  // scope (user-level preselected); non-interactive --defaults uses the default
  // user scope.
  const scope =
    options.scope ??
    (!options.targetPath && !options.defaultsOnly ? await promptScope(ask, log, workspaceDir) : 'user');

  // Explicit targets keep their extension-based format (`.json` implies JSON).
  // Scope-based targets pick the filename matching the output format so a JSON
  // run never lands in a .yaml file.
  let targetPath: string;
  let format: ConfigWizardFormat;
  if (options.targetPath) {
    targetPath = path.resolve(workspaceDir, options.targetPath);
    format = options.format ?? (targetPath.endsWith('.json') ? 'json' : 'yaml');
  } else {
    format = options.format ?? 'yaml';
    const dir = scope === 'workspace' ? workspaceDir : resolveUserConfigDir();
    targetPath = path.join(dir, format === 'json' ? 'mini-agent.config.json' : 'mini-agent.config.yaml');
  }

  if (options.defaultsOnly) {
    const content = serializeConfig(WIZARD_DEFAULT_FILE_CONFIG as Draft, format);
    assertConfigLoads(content, format, workspaceDir);
    log(`Config target: ${targetPath}`);
    return { path: targetPath, format, content, wrote: false };
  }

  const targetExists = fs.existsSync(targetPath) && fs.statSync(targetPath).isFile();

  if (targetExists && !options.dryRun && !options.force) {
    const answer = await ask(`${targetPath} already exists. Overwrite? [y/N] `);
    if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
      return { path: targetPath, format, content: '', wrote: false, aborted: true };
    }
  }

  const existing = loadExistingDraft(targetPath, workspaceDir, warn);
  const draft = deepMerge(WIZARD_DEFAULT_FILE_CONFIG as Draft, existing);

  let lastSection = '';
  for (const field of WIZARD_FIELDS) {
    if (field.section !== lastSection) {
      lastSection = field.section;
      log(`\n--- ${field.section} ---`);
    }
    await promptField(field, draft, ask, log);
  }

  const content = serializeConfig(draft, format);
  assertConfigLoads(content, format, workspaceDir);

  if (options.dryRun) {
    log(`Config target: ${targetPath}`);
    return { path: targetPath, format, content, wrote: false };
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
  return { path: targetPath, format, content, wrote: true };
};
