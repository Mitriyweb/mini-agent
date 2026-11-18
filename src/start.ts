import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs as parseNodeArgs } from 'node:util';
import concolor from 'concolor';

import { errorText, runAgent } from './agent/agent.ts';
import { createCompleter } from './agent/completer.ts';
import { loadWorkflows, loadSkills, resolveSlashCommand } from './agent/customizations.ts';
import { createProvider } from './agent/llm.ts';
import { createPermissions } from './agent/permissions.ts';
import { promptSelectModel, promptSelectProvider } from './agent/provider-cli.ts';
import { defaultProviderRegistry, ProviderRegistry } from './agent/providers/registry.ts';
import { registerCustomProviders } from './agent/providers/custom.ts';
import { Workspace } from './agent/workspace.ts';
import { AgentResultStatus, SubagentPhase, type AgentEvent } from './types/agent.ts';
import { PermissionMode } from './types/permissions.ts';
import { resolveAgentConfig, type ConfigIssue, type PartialAgentConfig } from './agent/config.ts';
import { runConfigWizard, type ConfigWizardFormat, type ConfigWizardScope } from './agent/config-wizard.ts';
import { validateProfileName } from './agent/profiles.ts';
import { Logger, type LogLevel } from './agent/logging.ts';
import { UsageTracker } from './agent/usage-tracker.ts';
import { filterSkills } from './agent/skills.ts';
import { DurableRun } from './agent/run-state.ts';
import { addMemoryEntry, loadProjectMemory, DEFAULT_MEMORY_PATH } from './agent/memory.ts';
import { OpenSpecOrchestrator } from './agent/orchestrator/orchestrator.ts';
import packageJson from '../package.json' with { type: 'json' };

const color = (concolor as any)({
  info: 'b,blue',
  warn: 'b,yellow',
  error: 'b,red',
  success: 'b,green',
  cyan: 'b,cyan',
  dim: 'gray',
});

const DEFAULT_MAX_STEPS = 30;
const VERSION = packageJson.version;

export enum ParsedCommand {
  Run = 'run',
  Resume = 'resume',
  Apply = 'apply',
  Review = 'review',
  Config = 'config',
}

export interface ParsedCLIOptions {
  autoApprove: boolean;
  workspaceDir: string;
  customProvider?: string;
  customModel?: string;
  customUrl?: string;
  maxSteps: number;
  help: boolean;
  version: boolean;
  task: string;
  command?: ParsedCommand;
  runId?: string;
  changeName?: string;
  maxRetries?: number;
  retryEnabled?: boolean;
  retryAttempts?: number;
  reviewEnabled?: boolean;
  reviewAuthorizedProvider?: string;
  logLevel?: LogLevel;
  costTracking?: boolean;
  skillsEnabled?: boolean;
  skillsAllow?: string[];
  systemPromptEnabled?: boolean;
  configPath?: string;
  /** Selected agent profile name (e.g. planner, developer, reviewer, qa). */
  profile?: string;
  /** Raw permission mode value from CLI ('normal', 'bypass', 'yolo', 'dangerous'); normalized during config resolution. */
  permissionMode?: string;
  /** `mini-agent config` wizard flags. */
  configDefaults?: boolean;
  configDryRun?: boolean;
  configForce?: boolean;
  configFormat?: ConfigWizardFormat;
  /** Wizard write scope; `--user` wins when both flags are present. */
  configScope?: ConfigWizardScope;
}

export const printHelp = () => {
  console.log(`
mini-agent - Compact modular coding agent harness
  Version: ${VERSION}

Usage:
  mini-agent [options] [task...]
  mini-agent run [options] "task..."
  mini-agent resume [options] <run-id>
  mini-agent apply [options] <change-name>
  mini-agent review [options] <run-id>
  mini-agent memory show
  mini-agent memory add "new knowledge"
  mini-agent config [options]      Interactive wizard that writes mini-agent.config.yaml

Quick examples:
  mini-agent "Add a small feature to the CLI"
  mini-agent apply add-user-authentication
  mini-agent --log-level verbose "Fix the failing tests"
  mini-agent --cost-tracking "Refactor authentication"
  mini-agent --skills git,code-review "Review this PR"
  mini-agent --no-skills "Analyze this code"
  mini-agent --no-system-prompt "Custom task without default prompt"

Common options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set project workspace directory
  -p, --provider <id>         Override LLM provider (router, openai, anthropic, google)
  --model <model_id>          Override model ID (default: model-router-auto for router)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1 for router)
  --max-steps <number>        Max agent execution steps (default: 30)
  --max-retries <number>      Max retries per task in apply mode (default: 3)
  --retry                     Enable automatic retry on transient LLM errors (default)
  --no-retry                  Disable automatic retry on transient LLM errors
  --retry-attempts <number>   Max retry attempts on transient LLM errors (default: 3)
  --log-level <level>         Set log level: off, normal, verbose (default: normal)
  --cost-tracking             Enable LLM token usage & cost tracking
  --no-cost-tracking          Disable LLM token usage & cost tracking
  --no-skills                 Disable all skills loading and prompt injection
  --skills <skill1,skill2>    Comma-separated list of allowed skills
  --system-prompt             Enable standard built-in system prompt (default)
  --no-system-prompt          Disable standard built-in system prompt
  --config <path>             Path to configuration YAML/JSON file (for 'config': output target)
  --defaults                  (config) Print a fully commented default config template
  --dry-run                   (config) Print the generated config without writing
  --force                     (config) Overwrite an existing config without confirmation
  --format <yaml|json>        (config) Output format (default: yaml, or json for .json targets)
  --user                      (config) Write the user-level config (~/.config/mini-agent)
  --workspace                 (config) Write the workspace config (mini-agent.config.yaml)
  --review                    Enable external review for the current run
  --no-review                 Disable external review for the current run
  --review-provider <id>      Provider to use for external review (e.g. openai, anthropic)
  --profile <name>            Apply a named role profile (default, planner, developer, reviewer, qa)
  --permission-mode <mode>    Permission mode: normal (default), bypass (aliases: yolo, dangerous)
  --bypass                    Shortcut for --permission-mode bypass (auto-approve all, skip quality gates)
  -v, --version               Show the installed version
  -h, --help                  Show this help text

REPL commands:
  /help                  Show workflow, skill, and command help
  /provider [id]         Select or change LLM provider
  /model [model_id]      Select or change active model
  /log-level [level]     Change current session log level (off, normal, verbose)
  /cost-tracking [on|off|toggle]  Toggle LLM cost tracking for this session
  /system-prompt [on|off|toggle] Toggle built-in system prompt for this session
  /auto-approve [on|off]  Toggle or set approval prompts
  /mode [normal|bypass]   Show or switch permission mode
  /bypass                 Switch to bypass mode (auto-approve all, skip quality gates)
  /yolo                   Alias for /bypass
  /dangerous              Alias for /bypass
  /normal                 Switch back to normal permission mode
  /workflows             List available workflow shortcuts
  /skills                List available skills
  /config [--user|--workspace]  Run the configuration wizard (restart to apply)
  /exit                  Exit the interactive session
  /quit                  Exit the interactive session
`);
};

export const parseArgs = (argv: string[]): ParsedCLIOptions => {
  const args = argv.slice(2);

  try {
    const parsed = parseNodeArgs({
      args,
      options: {
        'auto-approve': { type: 'boolean', short: 'y', default: false },
        yes: { type: 'boolean', default: false },
        dir: { type: 'string' },
        provider: { type: 'string', short: 'p' },
        model: { type: 'string' },
        url: { type: 'string' },
        'max-steps': { type: 'string', default: '30' },
        'max-retries': { type: 'string', default: '3' },
        retry: { type: 'boolean', default: undefined },
        'no-retry': { type: 'boolean', default: false },
        'retry-attempts': { type: 'string' },
        'log-level': { type: 'string' },
        'cost-tracking': { type: 'boolean', default: undefined },
        'no-cost-tracking': { type: 'boolean', default: false },
        'no-skills': { type: 'boolean', default: false },
        skills: { type: 'string' },
        'system-prompt': { type: 'boolean', default: undefined },
        'no-system-prompt': { type: 'boolean', default: false },
        config: { type: 'string' },
        review: { type: 'boolean', default: undefined },
        'no-review': { type: 'boolean', default: false },
        'review-provider': { type: 'string' },
        'review-authorized-provider': { type: 'string' },
        profile: { type: 'string' },
        'permission-mode': { type: 'string' },
        bypass: { type: 'boolean', default: false },
        defaults: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        force: { type: 'boolean', default: false },
        format: { type: 'string' },
        user: { type: 'boolean', default: false },
        workspace: { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });

    const autoApprove =
      Boolean(parsed.values['auto-approve']) || Boolean(parsed.values.yes) || process.env.AUTO_APPROVE === 'true';
    const help = Boolean(parsed.values.help);
    const customProvider = (parsed.values.provider as string | undefined) || process.env.PROVIDER;
    const customModel = (parsed.values.model as string | undefined) || process.env.MODEL;
    const customUrl = (parsed.values.url as string | undefined) || process.env.OPENAI_BASE_URL;
    const maxSteps = parseInt((parsed.values['max-steps'] as string) || '30', 10) || DEFAULT_MAX_STEPS;
    let maxRetries = 3;
    if (parsed.values['max-retries'] !== undefined) {
      const parsedRetries = parseInt(parsed.values['max-retries'] as string, 10);
      if (Number.isInteger(parsedRetries) && parsedRetries >= 0) {
        maxRetries = parsedRetries;
      }
    }
    let retryEnabled: boolean | undefined;
    if (parsed.values['no-retry']) {
      retryEnabled = false;
    } else if (parsed.values.retry === true) {
      retryEnabled = true;
    }

    let retryAttempts: number | undefined;
    if (parsed.values['retry-attempts'] !== undefined) {
      const parsedAttempts = parseInt(parsed.values['retry-attempts'] as string, 10);
      if (Number.isInteger(parsedAttempts) && parsedAttempts >= 1) {
        retryAttempts = parsedAttempts;
      }
    }

    const version = Boolean(parsed.values.version);

    let logLevel: LogLevel | undefined;
    if (parsed.values['log-level']) {
      const levelStr = (parsed.values['log-level'] as string).toLowerCase();
      if (levelStr === 'off' || levelStr === 'normal' || levelStr === 'verbose') {
        logLevel = levelStr as LogLevel;
      }
    }

    let costTracking: boolean | undefined;
    if (parsed.values['no-cost-tracking']) {
      costTracking = false;
    } else if (parsed.values['cost-tracking'] === true) {
      costTracking = true;
    }

    let skillsEnabled: boolean | undefined;
    let skillsAllow: string[] | undefined;
    if (parsed.values['no-skills']) {
      skillsEnabled = false;
    } else if (parsed.values.skills) {
      skillsEnabled = true;
      skillsAllow = (parsed.values.skills as string)
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
    }

    let systemPromptEnabled: boolean | undefined;
    if (parsed.values['no-system-prompt']) {
      systemPromptEnabled = false;
    } else if (parsed.values['system-prompt'] === true) {
      systemPromptEnabled = true;
    }

    const configPath = parsed.values.config as string | undefined;
    const profile = (parsed.values as Record<string, unknown>).profile as string | undefined;
    const permissionMode = parsed.values.bypass
      ? 'bypass'
      : (parsed.values['permission-mode'] as string | undefined);
    const reviewEnabled = parsed.values.review === true ? true : parsed.values['no-review'] === true ? false : undefined;
    const reviewAuthorizedProvider =
      (parsed.values['review-provider'] as string | undefined) ??
      (parsed.values['review-authorized-provider'] as string | undefined) ??
      process.env.MINI_AGENT_EXTERNAL_REVIEW_PROVIDER ??
      process.env.EXTERNAL_REVIEW_PROVIDER;

    const configFormatRaw = (parsed.values.format as string | undefined)?.toLowerCase();
    const configFormat: ConfigWizardFormat | undefined =
      configFormatRaw === 'yaml' || configFormatRaw === 'yml'
        ? 'yaml'
        : configFormatRaw === 'json'
          ? 'json'
          : undefined;
    const configScope: ConfigWizardScope | undefined = parsed.values.user
      ? 'user'
      : parsed.values.workspace
        ? 'workspace'
        : undefined;

    let workspaceDir = (parsed.values.dir as string | undefined) || process.cwd();
    const positionals = parsed.positionals;
    const taskParts: string[] = [];

    for (let i = 0; i < positionals.length; i++) {
      const arg = positionals[i];
      if (
        i === 0 &&
        !parsed.values.dir &&
        fs.existsSync(path.resolve(arg)) &&
        fs.statSync(path.resolve(arg)).isDirectory()
      ) {
        workspaceDir = arg;
      } else {
        taskParts.push(arg);
      }
    }

    const command = taskParts[0] === ParsedCommand.Run || taskParts[0] === ParsedCommand.Resume || taskParts[0] === ParsedCommand.Apply || taskParts[0] === ParsedCommand.Review || taskParts[0] === ParsedCommand.Config
      ? taskParts.shift() as ParsedCommand
      : undefined;
    const runId = command === ParsedCommand.Resume || command === ParsedCommand.Review ? taskParts.shift() : undefined;
    const changeName = command === ParsedCommand.Apply ? taskParts.shift() : undefined;
    return {
      autoApprove,
      workspaceDir,
      customProvider,
      customModel,
      customUrl,
      maxSteps,
      maxRetries,
      retryEnabled,
      retryAttempts,
      help,
      version,
      task: taskParts.join(' ').trim(),
      command,
      runId,
      changeName,
      logLevel,
      costTracking,
      skillsEnabled,
      skillsAllow,
      systemPromptEnabled,
      configPath,
      profile,
      permissionMode,
      reviewEnabled,
      reviewAuthorizedProvider,
      configDefaults: Boolean(parsed.values.defaults),
      configDryRun: Boolean(parsed.values['dry-run']),
      configForce: Boolean(parsed.values.force),
      configFormat,
      configScope,
    };
  } catch {
    // Fallback manual parsing
    let autoApprove = process.env.AUTO_APPROVE === 'true';
    let workspaceDir = process.cwd();
    let customProvider = process.env.PROVIDER;
    let customModel = process.env.MODEL;
    let customUrl = process.env.OPENAI_BASE_URL;
    let maxSteps = DEFAULT_MAX_STEPS;
    let maxRetries = 3;
    let retryEnabled: boolean | undefined;
    let retryAttempts: number | undefined;
    let help = false;
    let version = false;
    let logLevel: LogLevel | undefined;
    let costTracking: boolean | undefined;
    let skillsEnabled: boolean | undefined;
    let skillsAllow: string[] | undefined;
    let systemPromptEnabled: boolean | undefined;
    let configPath: string | undefined;
    let profile: string | undefined;
    let permissionMode: string | undefined;
    let reviewEnabled: boolean | undefined;
    let reviewAuthorizedProvider: string | undefined;
    let configDefaults = false;
    let configDryRun = false;
    let configForce = false;
    let configFormat: ConfigWizardFormat | undefined;
    let configScope: ConfigWizardScope | undefined;
    const taskParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-y' || arg === '--auto-approve' || arg === '--yes') {
        autoApprove = true;
      } else if (arg === '-h' || arg === '--help') {
        help = true;
      } else if (arg === '-v' || arg === '--version') {
        version = true;
      } else if (arg === '--dir' && i + 1 < args.length) {
        workspaceDir = args[++i];
      } else if ((arg === '-p' || arg === '--provider') && i + 1 < args.length) {
        customProvider = args[++i];
      } else if (arg === '--model' && i + 1 < args.length) {
        customModel = args[++i];
      } else if (arg === '--url' && i + 1 < args.length) {
        customUrl = args[++i];
      } else if (arg === '--max-steps' && i + 1 < args.length) {
        maxSteps = parseInt(args[++i], 10) || DEFAULT_MAX_STEPS;
      } else if (arg === '--max-retries' && i + 1 < args.length) {
        const val = parseInt(args[++i], 10);
        if (Number.isInteger(val) && val >= 0) maxRetries = val;
      } else if (arg === '--retry') {
        retryEnabled = true;
      } else if (arg === '--no-retry') {
        retryEnabled = false;
      } else if (arg === '--retry-attempts' && i + 1 < args.length) {
        const val = parseInt(args[++i], 10);
        if (Number.isInteger(val) && val >= 1) retryAttempts = val;
      } else if (arg === '--log-level' && i + 1 < args.length) {
        const val = args[++i].toLowerCase();
        if (val === 'off' || val === 'normal' || val === 'verbose') logLevel = val as LogLevel;
      } else if (arg === '--cost-tracking') {
        costTracking = true;
      } else if (arg === '--no-cost-tracking') {
        costTracking = false;
      } else if (arg === '--no-skills') {
        skillsEnabled = false;
      } else if (arg === '--skills' && i + 1 < args.length) {
        skillsEnabled = true;
        skillsAllow = args[++i].split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (arg === '--system-prompt') {
        systemPromptEnabled = true;
      } else if (arg === '--no-system-prompt') {
        systemPromptEnabled = false;
      } else if (arg === '--config' && i + 1 < args.length) {
        configPath = args[++i];
      } else if (arg === '--review') {
        reviewEnabled = true;
      } else if (arg === '--no-review') {
        reviewEnabled = false;
      } else if ((arg === '--review-provider' || arg === '--review-authorized-provider') && i + 1 < args.length) {
        reviewAuthorizedProvider = args[++i];
      } else if (arg === '--profile' && i + 1 < args.length) {
        profile = args[++i];
      } else if (arg === '--permission-mode' && i + 1 < args.length) {
        permissionMode = args[++i];
      } else if (arg === '--bypass' || arg === '--yolo' || arg === '--dangerous') {
        permissionMode = 'bypass';
      } else if (arg === '--defaults') {
        configDefaults = true;
      } else if (arg === '--dry-run') {
        configDryRun = true;
      } else if (arg === '--force') {
        configForce = true;
      } else if (arg === '--format' && i + 1 < args.length) {
        const val = args[++i].toLowerCase();
        if (val === 'yaml' || val === 'yml') configFormat = 'yaml';
        else if (val === 'json') configFormat = 'json';
      } else if (arg === '--user') {
        configScope = 'user';
      } else if (arg === '--workspace') {
        if (!configScope) configScope = 'workspace';
      } else if (
        !arg.startsWith('-') &&
        taskParts.length === 0 &&
        fs.existsSync(path.resolve(arg)) &&
        fs.statSync(path.resolve(arg)).isDirectory()
      ) {
        workspaceDir = arg;
      } else {
        taskParts.push(arg);
      }
    }

    const command = taskParts[0] === ParsedCommand.Run || taskParts[0] === ParsedCommand.Resume || taskParts[0] === ParsedCommand.Apply || taskParts[0] === ParsedCommand.Review || taskParts[0] === ParsedCommand.Config
      ? taskParts.shift() as ParsedCommand
      : undefined;
    const runId = command === ParsedCommand.Resume || command === ParsedCommand.Review ? taskParts.shift() : undefined;
    const changeName = command === ParsedCommand.Apply ? taskParts.shift() : undefined;
    return {
      autoApprove,
      workspaceDir,
      customProvider,
      customModel,
      customUrl,
      maxSteps,
      maxRetries,
      retryEnabled,
      retryAttempts,
      help,
      version,
      task: taskParts.join(' ').trim(),
      command,
      runId,
      changeName,
      logLevel,
      costTracking,
      skillsEnabled,
      skillsAllow,
      systemPromptEnabled,
      configPath,
      profile,
      permissionMode,
      reviewEnabled,
      reviewAuthorizedProvider,
      configDefaults,
      configDryRun,
      configForce,
      configFormat,
      configScope,
    };
  }
};

export type PermissionModeCommand =
  | { kind: 'show' }
  | { kind: 'set'; mode: PermissionMode }
  | { kind: 'invalid' }
  | { kind: 'none' };

/**
 * Parse an interactive permission-mode slash command.
 * `/mode` shows the current mode, `/mode <mode>` sets it, and the
 * `/bypass` `/yolo` `/dangerous` `/normal` shortcuts set it directly.
 */
export const parsePermissionModeCommand = (input: string): PermissionModeCommand => {
  const trimmed = input.trim();
  if (trimmed === '/mode') return { kind: 'show' };
  if (trimmed === '/bypass' || trimmed === '/yolo' || trimmed === '/dangerous') {
    return { kind: 'set', mode: PermissionMode.BYPASS };
  }
  if (trimmed === '/normal') return { kind: 'set', mode: PermissionMode.NORMAL };
  if (trimmed.startsWith('/mode ')) {
    const value = trimmed.slice('/mode'.length).trim().toLowerCase();
    if (value === 'normal') return { kind: 'set', mode: PermissionMode.NORMAL };
    if (value === 'bypass' || value === 'yolo' || value === 'dangerous') {
      return { kind: 'set', mode: PermissionMode.BYPASS };
    }
    return { kind: 'invalid' };
  }
  return { kind: 'none' };
};

/**
 * Parse an interactive config-wizard slash command.
 * `/config` runs the wizard with the interactive scope prompt;
 * `/config --user` and `/config --workspace` skip that prompt.
 */
export type ConfigWizardCommand =
  | { kind: 'run'; scope?: ConfigWizardScope }
  | { kind: 'invalid' }
  | { kind: 'none' };

export const parseConfigWizardCommand = (input: string): ConfigWizardCommand => {
  const trimmed = input.trim();
  if (trimmed === '/config') return { kind: 'run' };
  if (!trimmed.startsWith('/config ')) return { kind: 'none' };

  let scope: ConfigWizardScope | undefined;
  const tokens = trimmed.slice('/config'.length).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { kind: 'run' };
  for (const token of tokens) {
    if (token === '--user') {
      scope = 'user';
    } else if (token === '--workspace') {
      if (!scope) scope = 'workspace';
    } else {
      return { kind: 'invalid' };
    }
  }
  return { kind: 'run', scope };
};

export const createEventHandler = (logger: Logger) => {
  return async (event: AgentEvent) => {
    if (logger.isOff()) {
      // `off` disables logging noise, but assistant replies are the run's
      // only user-facing output and must still reach the terminal.
      if (event.type === 'assistant') {
        console.log(color.success('\n🤖 Assistant:'));
        console.log(event.text);
      }
      return;
    }

    switch (event.type) {
      case 'step':
        logger.logNormal(color.info(`\n[Step ${event.step}/${event.maxSteps}] Using model: ${event.model}`));
        break;
      case 'tool':
        logger.logNormal(color.cyan(`⚡ Tool Call: ${event.name}`));
        if (event.argsText && event.argsText !== '{}') {
          logger.logNormal(color.dim(`   Arguments: ${event.argsText}`));
        }
        break;
      case 'result': {
        const badge = event.status === AgentResultStatus.OK ? color.success('✔') : color.error('✖');
        logger.logNormal(`${badge} Tool Result (${event.name}): status=${event.status}`);
        if (event.preview) {
          const lines = event.preview.split('\n').slice(0, 5).join('\n');
          logger.logNormal(color.dim(`   Output:\n${lines}`));
        }
        break;
      }
      case 'assistant':
        if (logger.hasFilePath()) {
          console.log(color.success('\n🤖 Assistant:'));
          console.log(event.text);
          break;
        }
        logger.logNormal(color.success('\n🤖 Assistant:'));
        logger.logNormal(event.text);
        break;
      case 'quality-gates':
        logger.logNormal(color.info('\nQuality gates:'));
        for (const result of event.results) {
          const badge = result.status === 'passed' ? color.success('✔') : result.status === 'skipped' ? color.warn('–') : color.error('✖');
          logger.logNormal(`${badge} ${result.required ? 'required' : 'optional'} ${result.name}: ${result.status}`);
        }
        break;
      case 'subagent':
        if (event.phase === SubagentPhase.Start) {
          logger.logNormal(color.dim(`   Subagent ${event.index + 1}/${event.total} [${event.access ?? 'write'}] started: ${String(event.task).slice(0, 80)}`));
        } else {
          const badge = event.status === 'completed' ? color.success('✔') : event.status === 'interrupted' ? color.warn('–') : color.error('✖');
          logger.logNormal(`${badge} Subagent ${event.index + 1}/${event.total}: ${event.status}${event.error ? ` (${String(event.error).slice(0, 120)})` : ''}`);
        }
        break;
    }
  };
};

const installInterruptHandler = (cleanup: () => void): (() => void) => {
  const handleInterrupt = () => {
    console.error('\nFlow interrupted.');
    cleanup();
    process.exitCode = 130;
    process.exit();
  };

  process.once('SIGINT', handleInterrupt);
  return () => process.off('SIGINT', handleInterrupt);
};

export const main = async () => {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.version) {
    console.log(VERSION);
    return;
  }

  if (options.command === ParsedCommand.Config) {
    if (options.task) {
      console.error(color.error('Usage: mini-agent config [--dir <path>] [--config <path>] [--user|--workspace] [--defaults] [--dry-run] [--force] [--format yaml|json]'));
      process.exitCode = 1;
      return;
    }
    const needsPrompt = !options.configDefaults;
    if (needsPrompt && !process.stdin.isTTY) {
      console.error(color.error('Error: the config wizard requires an interactive terminal. Use --defaults to print a template without prompting.'));
      process.exitCode = 1;
      return;
    }
    const rl = needsPrompt ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
    try {
      const result = await runConfigWizard({
        workspaceDir: options.workspaceDir,
        scope: options.configScope,
        targetPath: options.configPath,
        format: options.configFormat,
        defaultsOnly: options.configDefaults,
        dryRun: options.configDryRun,
        force: options.configForce,
        ask: rl ? (q) => rl.question(q) : undefined,
      });
      if (result.aborted) {
        console.log('Aborted; existing config left unchanged.');
      } else if (result.wrote) {
        console.log(color.success(`\nWrote ${result.path}`));
      } else {
        console.log(result.content);
      }
    } catch (err) {
      console.error(color.error(`Error: ${(err as Error).message}`));
      process.exitCode = 1;
    } finally {
      rl?.close();
    }
    return;
  }

  // Validate --profile early so the user gets a clear error before any runtime setup.
  if (options.profile) {
    const profileValidation = validateProfileName(options.profile);
    if (!profileValidation.valid) {
      console.error(color.error(`Error: ${profileValidation.error}`));
      process.exitCode = 1;
      return;
    }
  }

  const cliOverrides: PartialAgentConfig = {
    logging: options.logLevel ? { level: options.logLevel } : undefined,
    costTracking: options.costTracking !== undefined ? { enabled: options.costTracking } : undefined,
    skills:
      options.skillsEnabled !== undefined || options.skillsAllow !== undefined
        ? { enabled: options.skillsEnabled ?? true, allow: options.skillsAllow }
        : undefined,
    systemPrompt: options.systemPromptEnabled !== undefined ? { enabled: options.systemPromptEnabled } : undefined,
    retry:
      options.retryEnabled !== undefined || options.retryAttempts !== undefined
        ? {
            enabled: options.retryEnabled,
            maxAttempts: options.retryAttempts,
          }
        : undefined,
    review:
      options.reviewEnabled !== undefined || options.reviewAuthorizedProvider !== undefined
        ? {
            enabled: options.reviewEnabled ?? false,
            authorizedProvider: options.reviewAuthorizedProvider,
          }
        : undefined,
    provider: options.customProvider,
    model: options.customModel,
    baseURL: options.customUrl,
    maxSteps: options.maxSteps,
    autoApprove: options.autoApprove,
    permissionMode: options.permissionMode,
    configPath: options.configPath,
    profile: options.profile,
  };

  const configIssues: ConfigIssue[] = [];
  const resolvedConfig = resolveAgentConfig(cliOverrides, options.workspaceDir, configIssues);
  for (const issue of configIssues) {
    console.error(color.warn(`Config warning: ${issue.message}`));
    console.error(color.dim(`  Fix: ${issue.fixCommand}`));
  }
  const logger = new Logger({ level: resolvedConfig.logging.level, filePath: resolvedConfig.logging.filePath });

  const workspace = await Workspace.open(options.workspaceDir);

  const workflows = await loadWorkflows(workspace.root);
  const allSkills = await loadSkills(workspace.root);
  const filteredSkills = filterSkills(allSkills, resolvedConfig.skills);

  const providerOptions: Record<string, any> = {};
  if (resolvedConfig.provider) providerOptions.provider = resolvedConfig.provider;
  if (resolvedConfig.model) providerOptions.model = resolvedConfig.model;
  if (resolvedConfig.baseURL) providerOptions.baseURL = resolvedConfig.baseURL;
  providerOptions.retry = resolvedConfig.retry;
  providerOptions.customProviders = resolvedConfig.customProviders;

  const interactiveRegistry = new ProviderRegistry();
  registerCustomProviders(interactiveRegistry, resolvedConfig.customProviders);

  let provider = createProvider(providerOptions);
  const permissions = createPermissions({ autoApprove: resolvedConfig.autoApprove, permissionMode: resolvedConfig.permissionMode }, workspace);
  let durableRun: DurableRun | undefined;
  const removeInterruptHandler = installInterruptHandler(() => {
    durableRun?.interrupt();
    permissions.close();
  });

  if (!logger.isOff()) {
    console.log(color.info('=================================================='));
    console.log(color.info(`                 mini-agent v${VERSION}               `));
    console.log(color.info('=================================================='));
    console.log(`Workspace   : ${workspace.root}`);
    console.log(`Provider    : ${provider.providerId}`);
    console.log(`Base URL    : ${provider.baseURL}`);
    console.log(`Model       : ${provider.model}`);
    console.log(`AutoApprove : ${resolvedConfig.autoApprove ? 'YES' : 'NO'}`);
    console.log(`PermMode    : ${resolvedConfig.permissionMode}`);
    console.log(`Log Level   : ${resolvedConfig.logging.level}`);
    console.log(`Cost Track  : ${resolvedConfig.costTracking.enabled ? 'YES' : 'NO'}`);
    console.log(`Skills      : ${resolvedConfig.skills.enabled ? filteredSkills.map((s) => s.name).join(', ') || '(none)' : 'DISABLED'}`);
    console.log(`SystemPrompt: ${resolvedConfig.systemPrompt.enabled ? (resolvedConfig.systemPrompt.path ? resolvedConfig.systemPrompt.path : 'DEFAULT') : 'DISABLED'}`);
    console.log(`Retry       : ${resolvedConfig.retry.enabled ? `enabled (${resolvedConfig.retry.maxAttempts} attempts)` : 'disabled'}`);
    if (options.profile) console.log(`Profile     : ${options.profile}`);
    if (workflows.length > 0) console.log(`Workflows   : ${workflows.map((w) => w.command).join(', ')}`);
    console.log('--------------------------------------------------\n');
  } else {
    // `off` suppresses the full banner but keeps a compact identity line so
    // the run does not look like it failed to start.
    console.log(color.dim(`mini-agent v${VERSION} · ${workspace.root} · logging off`));
  }

  const onEvent = createEventHandler(logger);

  if (options.command === ParsedCommand.Resume && !options.runId) {
    console.error(color.error('Usage: mini-agent resume <run-id>'));
    removeInterruptHandler();
    permissions.close();
    process.exitCode = 1;
    return;
  }

  if (options.command === ParsedCommand.Apply) {
    const changeName = options.changeName;
    if (!changeName) {
      console.error(color.error('Usage: mini-agent apply <change-name>'));
      removeInterruptHandler();
      permissions.close();
      process.exitCode = 1;
      return;
    }

    removeInterruptHandler();
    const abortController = new AbortController();
    const removeApplyInterruptHandler = installInterruptHandler(() => {
      abortController.abort();
      permissions.close();
    });

    try {
      const usageTracker = new UsageTracker(resolvedConfig.costTracking);
      const orchestrator = new OpenSpecOrchestrator({
        workspace,
        changeName,
        provider,
        permissions,
        maxRetries: options.maxRetries,
        maxStepsPerTask: resolvedConfig.maxSteps ?? options.maxSteps,
        onEvent,
        workflows,
        skills: filteredSkills,
        logging: resolvedConfig.logging,
        audit: resolvedConfig.audit,
        costTracking: resolvedConfig.costTracking,
        skillsConfig: resolvedConfig.skills,
        systemPromptConfig: resolvedConfig.systemPrompt,
        logger,
        usageTracker,
        qualityGates: resolvedConfig.qualityGates,
        review: resolvedConfig.review,
        signal: abortController.signal,
        subagents: resolvedConfig.subagents,
        permissionMode: resolvedConfig.permissionMode,
      });

      const result = await orchestrator.run();
      if (!result.success) {
        process.exitCode = 1;
      }

      if (resolvedConfig.costTracking.enabled) {
        console.log(`\n${usageTracker.formatSummary()}`);
      }
    } catch (err) {
      logger.logError('Orchestration error', err);
      process.exitCode = 1;
    } finally {
      removeApplyInterruptHandler();
      permissions.close();
    }
    return;
  }

  if (options.command === ParsedCommand.Review) {
    if (!options.runId) {
      console.error(color.error('Usage: mini-agent review <run-id>'));
      removeInterruptHandler();
      permissions.close();
      process.exitCode = 1;
      return;
    }

    try {
      const run = DurableRun.load(workspace.root, options.runId, resolvedConfig.audit);
      const review = run.state.review;
      if (!review) {
        console.error(color.error(`Run '${options.runId}' has no external review result.`));
        process.exitCode = 1;
      } else {
        console.log(color.cyan(`Review verdict: ${review.verdict}`));
        console.log(review.findings || 'No findings reported.');
        if (review.verdict !== 'pass') {
          process.exitCode = 1;
        }
      }
    } catch (err) {
      logger.logError('Review lookup failed', err);
      process.exitCode = 1;
    } finally {
      removeInterruptHandler();
      permissions.close();
    }
    return;
  }

  const memoryCommand = options.task.trim();
  if (memoryCommand === 'memory' || memoryCommand.startsWith('memory ')) {
    const remainder = memoryCommand === 'memory' ? '' : memoryCommand.slice('memory '.length).trim();
    const subcommand = remainder === 'show' || remainder === '' ? 'show' : remainder.startsWith('add') ? 'add' : remainder;
    const memoryArgs = subcommand === 'add' ? remainder.slice('add'.length).trim() : '';

    if (subcommand === 'show') {
      const memory = await loadProjectMemory(workspace.root);
      if (!memory.trim()) {
        console.log(color.info(`No memory found at ${DEFAULT_MEMORY_PATH}.`));
      } else {
        console.log(memory);
      }
      permissions.close();
      removeInterruptHandler();
      return;
    }

    if (subcommand === 'add') {
      if (!memoryArgs) {
        console.error(color.error('Usage: mini-agent memory add "text"'));
        permissions.close();
        removeInterruptHandler();
        process.exitCode = 1;
        return;
      }

      const result = await addMemoryEntry(workspace.root, memoryArgs);
      console.log(color.success(`Memory updated at ${DEFAULT_MEMORY_PATH}`));
      console.log(result.content);
      permissions.close();
      removeInterruptHandler();
      return;
    }

    console.error(color.error('Usage: mini-agent memory show | mini-agent memory add "text"'));
    permissions.close();
    removeInterruptHandler();
    process.exitCode = 1;
    return;
  }

  if (options.task || options.command === ParsedCommand.Resume) {
    try {
      if (options.command === ParsedCommand.Run) {
        if (!options.task) throw new Error('Usage: mini-agent run "task"');
        durableRun = DurableRun.create(workspace.root, options.task, resolvedConfig.audit);
        console.log(color.cyan(`Run ID: ${durableRun.state.id}`));
      } else if (options.command === ParsedCommand.Resume) {
        durableRun = DurableRun.load(workspace.root, options.runId!, resolvedConfig.audit);
        durableRun.resume();
        console.log(color.cyan(`Resuming run: ${durableRun.state.id}`));
      }
    } catch (err) {
      logger.logError('Run setup error', err);
      removeInterruptHandler();
      permissions.close();
      process.exitCode = 1;
      return;
    }
    const resolvedCommand = resolveSlashCommand(options.task, workflows, filteredSkills);
    const taskText = durableRun?.state.task ?? (resolvedCommand?.matched ? resolvedCommand.prompt : options.task);
    if (!logger.isOff()) {
      if (resolvedCommand?.matched) {
        const commandLabel = resolvedCommand.kind === 'workflow' ? `${resolvedCommand.workflow?.command} (${resolvedCommand.workflow?.name})` : `${resolvedCommand.skill?.name}`;
        console.log(color.cyan(`Command: ${commandLabel}\n`));
      } else {
        console.log(color.cyan(`Task: ${options.task}\n`));
      }
    }
    try {
      const usageTracker = new UsageTracker(resolvedConfig.costTracking);
      const result = await runAgent({
        task: taskText,
        provider,
        permissions,
        workspace,
        maxSteps: resolvedConfig.maxSteps ?? options.maxSteps,
        onEvent,
        workflows,
        skills: allSkills,
        logging: resolvedConfig.logging,
        audit: resolvedConfig.audit,
        costTracking: resolvedConfig.costTracking,
        skillsConfig: resolvedConfig.skills,
        systemPromptConfig: resolvedConfig.systemPrompt,
        logger,
        usageTracker,
        durableRun,
        qualityGates: resolvedConfig.qualityGates,
        review: resolvedConfig.review,
        subagents: resolvedConfig.subagents,
        permissionMode: resolvedConfig.permissionMode,
        customProviders: resolvedConfig.customProviders,
      });

      const reviewFailed = result.reviewOutcome && result.reviewOutcome.verdict !== 'pass';
      if (!logger.isOff()) {
        if (reviewFailed) {
          console.log(color.error(`\nReview verdict: ${result.reviewOutcome!.verdict}`));
          console.log(color.error(result.reviewOutcome!.findings));
          console.log(color.error('Task completed with a failing external review.'));
        } else {
          console.log(color.success('\nTask completed successfully.'));
        }
      }

      if (reviewFailed) {
        process.exitCode = 1;
      }

      if (resolvedConfig.costTracking.enabled) {
        console.log(`\n${usageTracker.formatSummary()}`);
      }
    } catch (err) {
      logger.logError('Agent execution error', err);
      process.exitCode = 1;
    } finally {
      removeInterruptHandler();
      permissions.close();
    }
    return;
  }

  removeInterruptHandler();

  // Interactive REPL mode
  const completer = createCompleter({
    workspaceRoot: workspace.root,
    workflows,
    skills: filteredSkills,
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
  const permissionsRepl = createPermissions({
    autoApprove: resolvedConfig.autoApprove,
    permissionMode: resolvedConfig.permissionMode,
    rl,
    onPermissionModeChange: (mode) => {
      if (!logger.isOff()) {
        console.log(color.warn(`\nPermission mode switched to ${mode} for this session.\n`));
      }
    },
  }, workspace);
  const removeInterruptHandlerRepl = installInterruptHandler(() => {
    rl.close();
    permissionsRepl.close();
  });

  let priorMessages = null;
  let sessionMaxSteps = resolvedConfig.maxSteps ?? options.maxSteps;
  let sessionAutoApprove = resolvedConfig.autoApprove;

  if (!logger.isOff()) {
    console.log(color.info('Interactive session started. Type your task below or "exit" / "quit" to stop.'));
    console.log(color.dim('Type /help to see available options and slash commands.\n'));
  }

  try {
    while (rl) {
      const taskInput = await rl.question(color.cyan('mini-agent > '));
      const trimmed = taskInput.trim();
      if (!trimmed) continue;

      if (trimmed === '/exit' || trimmed === '/quit' || trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        break;
      }

      if (trimmed === '/skills') {
        console.log(color.info('\n--- Skills ---'));
        if (!resolvedConfig.skills.enabled) {
          console.log(color.dim('  (skills are disabled)'));
        } else if (filteredSkills.length === 0) {
          console.log(color.dim('  (none available)'));
        } else {
          for (const skill of filteredSkills) {
            console.log(color.cyan(`  ${skill.name}`) + ` - ${skill.description}`);
            console.log(color.dim(`      Use with: /${skill.name}`));
          }
        }
        console.log('');
        continue;
      }

      const configCommand = parseConfigWizardCommand(trimmed);
      if (configCommand.kind === 'invalid') {
        console.log(color.warn('Usage: /config [--user|--workspace]\n'));
        continue;
      }
      if (configCommand.kind === 'run') {
        try {
          const result = await runConfigWizard({
            workspaceDir: workspace.root,
            scope: configCommand.scope,
            ask: (question) => rl.question(question),
          });
          if (result.aborted) {
            console.log('Aborted; existing config left unchanged.');
          } else if (result.wrote) {
            console.log(color.success(`\nWrote ${result.path}`));
            console.log(color.warn('Restart mini-agent to apply the new configuration.\n'));
          } else {
            console.log(result.content);
          }
        } catch (err) {
          console.log(color.error(`\nConfig wizard failed: ${(err as Error).message}\n`));
        }
        continue;
      }

      if (trimmed === '/provider' || trimmed.startsWith('/provider ')) {
        const arg = trimmed.slice('/provider'.length).trim();
        let selectedDef = interactiveRegistry.get(arg);
        if (!selectedDef) {
          if (arg) {
            console.log(color.warn(`Unknown provider '${arg}'.`));
          }
          selectedDef = await promptSelectProvider(rl, interactiveRegistry);
        }

        let selectedModel = options.customModel;
        if (!arg || !selectedModel) {
          selectedModel = await promptSelectModel(rl, selectedDef);
        }

        try {
          provider = createProvider({
            provider: selectedDef.id,
            model: selectedModel,
            baseURL: options.customUrl,
            customProviders: resolvedConfig.customProviders,
          });
          console.log(color.success(`\nUsing ${selectedDef.name} / ${provider.model}\n`));
        } catch (err: any) {
          console.log(color.error(`\nFailed to switch provider: ${err?.message ?? err}\n`));
        }
        continue;
      }

      if (trimmed === '/model' || trimmed.startsWith('/model ')) {
        const arg = trimmed.slice('/model'.length).trim();
        let selectedModel = arg;

        if (!selectedModel) {
          const providerDef = interactiveRegistry.get(provider.providerId) ?? interactiveRegistry.get('router')!;
          selectedModel = await promptSelectModel(rl, providerDef, {
            apiKey: provider.apiKey,
            baseURL: provider.baseURL,
          });
        }

        try {
          provider = createProvider({
            provider: provider.providerId,
            model: selectedModel,
            baseURL: options.customUrl,
            customProviders: resolvedConfig.customProviders,
          });
          console.log(color.success(`\nUsing ${provider.providerId} / ${provider.model}\n`));
        } catch (err: any) {
          console.log(color.error(`\nFailed to switch model: ${err?.message ?? err}\n`));
        }
        continue;
      }

      if (trimmed === '/help') {
        console.log(color.info('\n--- Built-in commands ---'));
        console.log('  /help                Show this help text');
        console.log('  /provider [id]       Select or change LLM provider');
        console.log('  /model [model_id]    Select or change active model');
        console.log('  /log-level [level]   Change current session log level (off, normal, verbose)');
        console.log('  /cost-tracking [on|off|toggle]  Toggle LLM cost tracking for this session');
        console.log('  /system-prompt [on|off|toggle] Toggle built-in system prompt for this session');
        console.log('  /workflows           List available workflow shortcuts');
        console.log('  /skills              List available skills');
        console.log('  /config [--user|--workspace]  Run the configuration wizard (restart to apply)');
        console.log('  /max-steps <number>  Change the step limit for new tasks');
        console.log('  /auto-approve [on|off]  Toggle or set approval prompts');
        console.log('  /mode [normal|bypass]   Show or switch permission mode');
        console.log('  /bypass                 Switch to bypass mode (auto-approve all, skip quality gates)');
        console.log('  /yolo                   Alias for /bypass');
        console.log('  /dangerous              Alias for /bypass');
        console.log('  /normal                 Switch back to normal permission mode');
        console.log('  /exit                Exit the interactive session');
        console.log('  /quit                Exit the interactive session');

        console.log(color.info('\n--- Session options ---'));
        console.log(`  Provider            : ${provider.providerId}`);
        console.log(`  Model               : ${provider.model}`);
        console.log(`  Base URL            : ${provider.baseURL}`);
        console.log(`  Log Level           : ${resolvedConfig.logging.level}`);
        console.log(`  Cost Tracking       : ${resolvedConfig.costTracking.enabled ? 'ON' : 'OFF'}`);
        console.log(`  Skills Enabled      : ${resolvedConfig.skills.enabled ? 'YES' : 'NO'}`);
        console.log(`  System Prompt       : ${resolvedConfig.systemPrompt.enabled ? 'ENABLED' : 'DISABLED'}`);
        console.log(`  --max-steps ${sessionMaxSteps}   Maximum agent steps for each task`);
        console.log(`  --auto-approve ${sessionAutoApprove ? 'on' : 'off'}  Skip tool approval prompts`);
        console.log(`  Permission Mode     : ${permissionsRepl.getPermissionMode()}`);

        console.log(color.info('\n--- Workflows ---'));
        if (workflows.length === 0) {
          console.log(color.dim('  (none found)'));
        } else {
          for (const wf of workflows) {
            console.log(color.cyan(`  ${wf.command}`) + ` - ${wf.description}`);
            console.log(color.dim(`      Example: ${wf.command}`));
          }
        }

        console.log(color.info('\n--- Examples ---'));
        console.log('  /provider openai');
        console.log('  /model gpt-4o');
        console.log('  /review-and-commit');
        console.log('  exit');
        console.log('');
        continue;
      }

      if (trimmed === '/workflows') {
        console.log(color.info('\n--- Workflows ---'));
        if (workflows.length === 0) {
          console.log(color.dim('  (none found)'));
        } else {
          for (const wf of workflows) {
            console.log(color.cyan(`  ${wf.command}`) + ` - ${wf.description}`);
            console.log(color.dim(`      Example: ${wf.command}`));
          }
        }
        console.log('');
        continue;
      }

      if (trimmed.startsWith('/max-steps')) {
        const value = trimmed.slice('/max-steps'.length).trim();
        const parsed = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed < 1) {
          console.log(color.warn('Usage: /max-steps <positive number>\n'));
          continue;
        }
        sessionMaxSteps = parsed;
        console.log(color.success(`Maximum steps set to ${sessionMaxSteps}.\n`));
        continue;
      }

      if (trimmed === '/auto-approve' || trimmed.startsWith('/auto-approve ')) {
        const value = trimmed.slice('/auto-approve'.length).trim().toLowerCase();
        if (value !== '' && value !== 'on' && value !== 'off' && value !== 'toggle') {
          console.log(color.warn('Usage: /auto-approve [on|off|toggle]\n'));
          continue;
        }
        sessionAutoApprove = value === 'on' || (value !== 'off' && !sessionAutoApprove);
        permissionsRepl.setAutoApprove(sessionAutoApprove);
        console.log(color.success(`Auto-approve ${sessionAutoApprove ? 'enabled' : 'disabled'}.\n`));
        continue;
      }

      const modeCommand = parsePermissionModeCommand(trimmed);
      if (modeCommand.kind === 'show') {
        console.log(color.info(`\nPermission mode: ${permissionsRepl.getPermissionMode()}\n`));
        continue;
      }
      if (modeCommand.kind === 'invalid') {
        console.log(color.warn('Usage: /mode [normal|bypass]\n'));
        continue;
      }
      if (modeCommand.kind === 'set') {
        permissionsRepl.setPermissionMode(modeCommand.mode);
        console.log(color.success(`Permission mode set to ${modeCommand.mode} for this session.\n`));
        continue;
      }

      if (trimmed === '/log-level' || trimmed.startsWith('/log-level ')) {
        const value = trimmed.slice('/log-level'.length).trim().toLowerCase();
        if (!value || (value !== 'off' && value !== 'normal' && value !== 'verbose')) {
          console.log(color.warn('Usage: /log-level [off|normal|verbose]\n'));
          continue;
        }

        resolvedConfig.logging.level = value as LogLevel;
        logger.level = value as LogLevel;
        console.log(color.success(`Log level set to ${resolvedConfig.logging.level}.\n`));
        continue;
      }

      if (trimmed === '/cost-tracking' || trimmed.startsWith('/cost-tracking ')) {
        const value = trimmed.slice('/cost-tracking'.length).trim().toLowerCase();

        if (value !== '' && value !== 'on' && value !== 'off' && value !== 'toggle') {
          console.log(color.warn('Usage: /cost-tracking [on|off|toggle]\n'));
          continue;
        }

        const nextEnabled = value === 'on' || (value !== 'off' && !resolvedConfig.costTracking.enabled);
        resolvedConfig.costTracking.enabled = nextEnabled;
        console.log(color.success(`Cost tracking ${nextEnabled ? 'enabled' : 'disabled'} for this session.\n`));
        continue;
      }

      if (trimmed === '/system-prompt' || trimmed.startsWith('/system-prompt ')) {
        const value = trimmed.slice('/system-prompt'.length).trim().toLowerCase();

        if (value !== '' && value !== 'on' && value !== 'off' && value !== 'toggle') {
          console.log(color.warn('Usage: /system-prompt [on|off|toggle]\n'));
          continue;
        }

        const nextEnabled = value === 'on' || (value !== 'off' && !resolvedConfig.systemPrompt.enabled);
        resolvedConfig.systemPrompt.enabled = nextEnabled;
        console.log(color.success(`System prompt ${nextEnabled ? 'enabled' : 'disabled'} for this session.\n`));
        continue;
      }

      let taskToRun = trimmed;
      if (trimmed.startsWith('/')) {
        const resolvedCommand = resolveSlashCommand(trimmed, workflows, filteredSkills);
        if (resolvedCommand?.matched) {
          const commandLabel = resolvedCommand.kind === 'workflow'
            ? `${resolvedCommand.workflow?.command}`
            : `/${resolvedCommand.skill?.name}`;
          console.log(color.cyan(`\n⚡ Running command: ${commandLabel}\n`));
          taskToRun = resolvedCommand.prompt;
        } else {
          console.log(color.warn(`Unknown command: ${trimmed}. Type /workflows to list workflows.\n`));
          continue;
        }
      }

      try {
        const usageTracker = new UsageTracker(resolvedConfig.costTracking);
        const result = await runAgent({
          task: taskToRun,
          provider,
          permissions: permissionsRepl,
          workspace,
          maxSteps: sessionMaxSteps,
          onEvent,
          priorMessages,
          workflows,
          skills: allSkills,
          logging: resolvedConfig.logging,
        audit: resolvedConfig.audit,
          costTracking: resolvedConfig.costTracking,
          skillsConfig: resolvedConfig.skills,
          systemPromptConfig: resolvedConfig.systemPrompt,
          logger,
          usageTracker,
          qualityGates: resolvedConfig.qualityGates,
          customProviders: resolvedConfig.customProviders,
          permissionMode: resolvedConfig.permissionMode,
        });
        priorMessages = result.messages;

        if (resolvedConfig.costTracking.enabled) {
          console.log(`\n${usageTracker.formatSummary()}`);
        }
      } catch (err) {
        logger.logError('Agent execution error', err);
      }
      console.log('\n--------------------------------------------------');
    }
  } finally {
    removeInterruptHandlerRepl();
    rl?.close();
    permissionsRepl.close();
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(color.error(`\nFatal error: ${errorText(error)}`));
    process.exitCode = 1;
  });
}
