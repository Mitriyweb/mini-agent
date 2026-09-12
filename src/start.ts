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
}

export const printHelp = () => {
  console.log(`
mini-agent - Compact modular coding agent harness
  Version: ${VERSION}

Usage:
  mini-agent [options] [task...]

Quick examples:
  mini-agent "Add a small feature to the CLI"
  mini-agent --provider openai --model gpt-4o "Refactor a helper"
  mini-agent --provider router "Run via Model Router"
  mini-agent --auto-approve "Run a task without approval prompts"

Common options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set project workspace directory
  -p, --provider <id>         Override LLM provider (router, openai, anthropic, google)
  --model <model_id>          Override model ID (default: model-router-auto for router)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1 for router)
  --max-steps <number>        Max agent execution steps (default: 30)
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

Built-in capabilities:
  - Read/write/edit/patch/delete files in the workspace
  - Search with glob and grep
  - Run bash and syntax checks
  - Inspect OpenAPI/JSON/YAML specs via the openspec tool
  - Run workflow-driven tasks from slash commands

Notes:
  - Default step limit is 30 to prevent runaway agent loops.
  - Direct provider mode bypasses model-router and connects directly to provider APIs.
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
    };
  } catch {
    // Fallback parsing
    let autoApprove = process.env.AUTO_APPROVE === 'true';
    let workspaceDir = process.cwd();
    let customProvider = process.env.PROVIDER;
    let customModel = process.env.MODEL;
    let customUrl = process.env.OPENAI_BASE_URL;
    let maxSteps = DEFAULT_MAX_STEPS;
    let help = false;
    let version = false;
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
    };
  }
};

export const createEventHandler = () => {
  return async (event: AgentEvent) => {
    switch (event.type) {
      case 'step':
        console.log(color.info(`\n[Step ${event.step}/${event.maxSteps}] Using model: ${event.model}`));
        break;
      case 'tool':
        console.log(color.cyan(`⚡ Tool Call: ${event.name}`));
        if (event.argsText && event.argsText !== '{}') {
          console.log(color.dim(`   Arguments: ${event.argsText}`));
        }
        break;
      case 'result': {
        const badge = event.status === AgentResultStatus.OK ? color.success('✔') : color.error('✖');
        console.log(`${badge} Tool Result (${event.name}): status=${event.status}`);
        if (event.preview) {
          const lines = event.preview.split('\n').slice(0, 5).join('\n');
          console.log(color.dim(`   Output:\n${lines}`));
        }
        break;
      }
      case 'assistant':
        console.log(color.success('\n🤖 Assistant:'));
        console.log(event.text);
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

  const workspace = await Workspace.open(options.workspaceDir);

  const workflows = await loadWorkflows(workspace.root);
  const skills = await loadSkills(workspace.root);

  const providerOptions: Record<string, any> = {};
  if (options.customProvider) providerOptions.provider = options.customProvider;
  if (options.customModel) providerOptions.model = options.customModel;
  if (options.customUrl) providerOptions.baseURL = options.customUrl;

  let provider = createProvider(providerOptions);
  const permissions = createPermissions({ autoApprove: options.autoApprove }, workspace);
  const removeInterruptHandler = installInterruptHandler(() => permissions.close());

  console.log(color.info('=================================================='));
  console.log(color.info(`                 mini-agent v${VERSION}               `));
  console.log(color.info('=================================================='));
  console.log(`Workspace : ${workspace.root}`);
  console.log(`Provider  : ${provider.providerId}`);
  console.log(`Base URL  : ${provider.baseURL}`);
  console.log(`Model     : ${provider.model}`);
  console.log(`AutoApprove: ${options.autoApprove ? 'YES' : 'NO'}`);
  if (workflows.length > 0) console.log(`Workflows : ${workflows.map((w) => w.command).join(', ')}`);
  if (skills.length > 0) console.log(`Skills    : ${skills.map((s) => s.name).join(', ')}`);
  console.log('--------------------------------------------------\n');

  const onEvent = createEventHandler();

  if (options.task) {
    const resolvedWf = resolveWorkflowCommand(options.task, workflows);
    const taskText = resolvedWf?.matched ? resolvedWf.prompt : options.task;
    if (resolvedWf?.matched) {
      console.log(color.cyan(`Workflow: ${resolvedWf.workflow.command} (${resolvedWf.workflow.name})\n`));
    } else {
      console.log(color.cyan(`Task: ${options.task}\n`));
    }
    try {
      await runAgent({
        task: taskText,
        provider,
        permissions,
        workspace,
        maxSteps: options.maxSteps,
        onEvent,
        workflows,
        skills,
      });
      console.log(color.success('\nTask completed successfully.'));
    } catch (err) {
      console.error(color.error(`\nAgent error: ${errorText(err)}`));
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
    skills,
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout, completer });
  const permissionsRepl = createPermissions({ autoApprove: options.autoApprove, rl }, workspace);
  const removeInterruptHandlerRepl = installInterruptHandler(() => {
    rl.close();
    permissionsRepl.close();
  });

  let priorMessages = null;
  let sessionMaxSteps = options.maxSteps;
  let sessionAutoApprove = options.autoApprove;

  console.log(color.info('Interactive session started. Type your task below or "exit" / "quit" to stop.'));
  console.log(color.dim('Type /help to see available options and slash commands.\n'));

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
        if (skills.length === 0) {
          console.log(color.dim('  (none found)'));
        } else {
          for (const skill of skills) {
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
        const result = await runAgent({
          task: taskToRun,
          provider,
          permissions: permissionsRepl,
          workspace,
          maxSteps: sessionMaxSteps,
          onEvent,
          priorMessages,
          workflows,
          skills,
        });
        priorMessages = result.messages;
      } catch (err) {
        console.error(color.error(`\nAgent error: ${errorText(err)}`));
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
