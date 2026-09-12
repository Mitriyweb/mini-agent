import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs as parseNodeArgs } from 'node:util';
import concolor from 'concolor';

import { errorText, runAgent } from './agent/agent.js';
import { createCompleter } from './agent/completer.js';
import { loadWorkflows, loadSkills, resolveWorkflowCommand } from './agent/customizations.js';
import { createProvider } from './agent/llm.js';
import { createPermissions } from './agent/permissions.js';
import { promptSelectModel, promptSelectProvider } from './agent/provider-cli.js';
import { defaultProviderRegistry } from './agent/providers/registry.js';
import { Workspace } from './agent/workspace.js';
import { AgentResultStatus, type AgentEvent } from './types/agent.js';
import { resolveAgentConfig, type PartialAgentConfig } from './agent/config.js';
import { Logger, type LogLevel } from './agent/logging.js';
import { UsageTracker } from './agent/usage-tracker.js';
import { filterSkills } from './agent/skills.js';
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
  logLevel?: LogLevel;
  costTracking?: boolean;
  skillsEnabled?: boolean;
  skillsAllow?: string[];
  systemPromptEnabled?: boolean;
  configPath?: string;
}

export const printHelp = () => {
  console.log(`
mini-agent - Compact modular coding agent harness
  Version: ${VERSION}

Usage:
  mini-agent [options] [task...]

Quick examples:
  mini-agent "Add a small feature to the CLI"
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
  --log-level <level>         Set log level: off, normal, verbose (default: normal)
  --cost-tracking             Enable LLM token usage & cost tracking
  --no-cost-tracking          Disable LLM token usage & cost tracking
  --no-skills                 Disable all skills loading and prompt injection
  --skills <skill1,skill2>    Comma-separated list of allowed skills
  --system-prompt             Enable standard built-in system prompt (default)
  --no-system-prompt          Disable standard built-in system prompt
  --config <path>             Path to configuration YAML/JSON file
  -v, --version               Show the installed version
  -h, --help                  Show this help text

REPL commands:
  /help                  Show workflow, skill, and command help
  /provider [id]         Select or change LLM provider
  /model [model_id]      Select or change active model
  /workflows             List available workflow shortcuts
  /skills                List available skills
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
        'log-level': { type: 'string' },
        'cost-tracking': { type: 'boolean', default: undefined },
        'no-cost-tracking': { type: 'boolean', default: false },
        'no-skills': { type: 'boolean', default: false },
        skills: { type: 'string' },
        'system-prompt': { type: 'boolean', default: undefined },
        'no-system-prompt': { type: 'boolean', default: false },
        config: { type: 'string' },
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

    return {
      autoApprove,
      workspaceDir,
      customProvider,
      customModel,
      customUrl,
      maxSteps,
      help,
      version,
      task: taskParts.join(' ').trim(),
      logLevel,
      costTracking,
      skillsEnabled,
      skillsAllow,
      systemPromptEnabled,
      configPath,
    };
  } catch {
    // Fallback manual parsing
    let autoApprove = process.env.AUTO_APPROVE === 'true';
    let workspaceDir = process.cwd();
    let customProvider = process.env.PROVIDER;
    let customModel = process.env.MODEL;
    let customUrl = process.env.OPENAI_BASE_URL;
    let maxSteps = DEFAULT_MAX_STEPS;
    let help = false;
    let version = false;
    let logLevel: LogLevel | undefined;
    let costTracking: boolean | undefined;
    let skillsEnabled: boolean | undefined;
    let skillsAllow: string[] | undefined;
    let systemPromptEnabled: boolean | undefined;
    let configPath: string | undefined;
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

    return {
      autoApprove,
      workspaceDir,
      customProvider,
      customModel,
      customUrl,
      maxSteps,
      help,
      version,
      task: taskParts.join(' ').trim(),
      logLevel,
      costTracking,
      skillsEnabled,
      skillsAllow,
      systemPromptEnabled,
      configPath,
    };
  }
};

export const createEventHandler = (logger: Logger) => {
  return async (event: AgentEvent) => {
    if (logger.isOff()) return;

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
        logger.logNormal(color.success('\n🤖 Assistant:'));
        logger.logNormal(event.text);
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

  const cliOverrides: PartialAgentConfig = {
    logging: options.logLevel ? { level: options.logLevel } : undefined,
    costTracking: options.costTracking !== undefined ? { enabled: options.costTracking } : undefined,
    skills:
      options.skillsEnabled !== undefined || options.skillsAllow !== undefined
        ? { enabled: options.skillsEnabled ?? true, allow: options.skillsAllow }
        : undefined,
    systemPrompt: options.systemPromptEnabled !== undefined ? { enabled: options.systemPromptEnabled } : undefined,
    provider: options.customProvider,
    model: options.customModel,
    baseURL: options.customUrl,
    maxSteps: options.maxSteps,
    autoApprove: options.autoApprove,
    configPath: options.configPath,
  };

  const resolvedConfig = resolveAgentConfig(cliOverrides, options.workspaceDir);
  const logger = new Logger({ level: resolvedConfig.logging.level });

  const workspace = await Workspace.open(options.workspaceDir);

  const workflows = await loadWorkflows(workspace.root);
  const allSkills = await loadSkills(workspace.root);
  const filteredSkills = filterSkills(allSkills, resolvedConfig.skills);

  const providerOptions: Record<string, any> = {};
  if (resolvedConfig.provider) providerOptions.provider = resolvedConfig.provider;
  if (resolvedConfig.model) providerOptions.model = resolvedConfig.model;
  if (resolvedConfig.baseURL) providerOptions.baseURL = resolvedConfig.baseURL;

  let provider = createProvider(providerOptions);
  const permissions = createPermissions({ autoApprove: resolvedConfig.autoApprove }, workspace);
  const removeInterruptHandler = installInterruptHandler(() => permissions.close());

  if (!logger.isOff()) {
    console.log(color.info('=================================================='));
    console.log(color.info(`                 mini-agent v${VERSION}               `));
    console.log(color.info('=================================================='));
    console.log(`Workspace   : ${workspace.root}`);
    console.log(`Provider    : ${provider.providerId}`);
    console.log(`Base URL    : ${provider.baseURL}`);
    console.log(`Model       : ${provider.model}`);
    console.log(`AutoApprove : ${resolvedConfig.autoApprove ? 'YES' : 'NO'}`);
    console.log(`Log Level   : ${resolvedConfig.logging.level}`);
    console.log(`Cost Track  : ${resolvedConfig.costTracking.enabled ? 'YES' : 'NO'}`);
    console.log(`Skills      : ${resolvedConfig.skills.enabled ? filteredSkills.map((s) => s.name).join(', ') || '(none)' : 'DISABLED'}`);
    console.log(`SystemPrompt: ${resolvedConfig.systemPrompt.enabled ? (resolvedConfig.systemPrompt.path ? resolvedConfig.systemPrompt.path : 'DEFAULT') : 'DISABLED'}`);
    if (workflows.length > 0) console.log(`Workflows   : ${workflows.map((w) => w.command).join(', ')}`);
    console.log('--------------------------------------------------\n');
  }

  const onEvent = createEventHandler(logger);

  if (options.task) {
    const resolvedWf = resolveWorkflowCommand(options.task, workflows);
    const taskText = resolvedWf?.matched ? resolvedWf.prompt : options.task;
    if (!logger.isOff()) {
      if (resolvedWf?.matched) {
        console.log(color.cyan(`Workflow: ${resolvedWf.workflow.command} (${resolvedWf.workflow.name})\n`));
      } else {
        console.log(color.cyan(`Task: ${options.task}\n`));
      }
    }
    try {
      const usageTracker = new UsageTracker(resolvedConfig.costTracking);
      await runAgent({
        task: taskText,
        provider,
        permissions,
        workspace,
        maxSteps: resolvedConfig.maxSteps ?? options.maxSteps,
        onEvent,
        workflows,
        skills: allSkills,
        logging: resolvedConfig.logging,
        costTracking: resolvedConfig.costTracking,
        skillsConfig: resolvedConfig.skills,
        systemPromptConfig: resolvedConfig.systemPrompt,
        logger,
        usageTracker,
      });

      if (!logger.isOff()) {
        console.log(color.success('\nTask completed successfully.'));
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

  // Interactive REPL mode
  const completer = createCompleter({
    workspaceRoot: workspace.root,
    workflows,
    skills: filteredSkills,
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
  const permissionsRepl = createPermissions({ autoApprove: resolvedConfig.autoApprove, rl }, workspace);
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

      if (trimmed === '/provider' || trimmed.startsWith('/provider ')) {
        const arg = trimmed.slice('/provider'.length).trim();
        let selectedDef = defaultProviderRegistry.get(arg);
        if (!selectedDef) {
          if (arg) {
            console.log(color.warn(`Unknown provider '${arg}'.`));
          }
          selectedDef = await promptSelectProvider(rl, defaultProviderRegistry);
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
          const providerDef = defaultProviderRegistry.get(provider.providerId) ?? defaultProviderRegistry.get('router')!;
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
        console.log('  /workflows           List available workflow shortcuts');
        console.log('  /skills              List available skills');
        console.log('  /max-steps <number>  Change the step limit for new tasks');
        console.log('  /auto-approve [on|off]  Toggle or set approval prompts');
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

      let taskToRun = trimmed;
      if (trimmed.startsWith('/')) {
        const resolvedWf = resolveWorkflowCommand(trimmed, workflows);
        if (resolvedWf?.matched) {
          console.log(color.cyan(`\n⚡ Running workflow: ${resolvedWf.workflow.command}\n`));
          taskToRun = resolvedWf.prompt;
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
          costTracking: resolvedConfig.costTracking,
          skillsConfig: resolvedConfig.skills,
          systemPromptConfig: resolvedConfig.systemPrompt,
          logger,
          usageTracker,
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
