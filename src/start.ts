import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs as parseNodeArgs } from 'node:util';
import concolor from 'concolor';

import { errorText, runAgent } from './agent/agent.js';
import { loadWorkflows, loadSkills, resolveWorkflowCommand } from './agent/customizations.js';
import { createProvider } from './agent/llm.js';
import { createPermissions } from './agent/permissions.js';
import { Workspace } from './agent/workspace.js';
import type { AgentEvent } from './types/agent.js';

const color = (concolor as any)({
  info: 'b,blue',
  warn: 'b,yellow',
  error: 'b,red',
  success: 'b,green',
  cyan: 'b,cyan',
  dim: 'gray',
});

const DEFAULT_MAX_STEPS = 30;

export interface ParsedCLIOptions {
  autoApprove: boolean;
  workspaceDir: string;
  customModel?: string;
  customUrl?: string;
  maxSteps: number;
  help: boolean;
  task: string;
}

export const printHelp = () => {
  console.log(`
mini-agent - Compact modular coding agent harness

Usage:
  mini-agent [options] [task...]

Options:
  -y, --auto-approve, --yes   Auto-approve tool execution without interactive prompt
  --dir <path>                Set project workspace directory
  --model <model_id>          Override model ID (default: model-router-auto)
  --url <base_url>            Override API base URL (default: http://localhost:8787/v1)
  --max-steps <number>        Max agent execution steps (default: 30)
  -h, --help                  Show this help text
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
        model: { type: 'string' },
        url: { type: 'string' },
        'max-steps': { type: 'string', default: '30' },
        help: { type: 'boolean', short: 'h', default: false },
      },
      allowPositionals: true,
    });

    const autoApprove =
      Boolean(parsed.values['auto-approve']) || Boolean(parsed.values.yes) || process.env.AUTO_APPROVE === 'true';
    const help = Boolean(parsed.values.help);
    const customModel = (parsed.values.model as string | undefined) || process.env.MODEL;
    const customUrl = (parsed.values.url as string | undefined) || process.env.OPENAI_BASE_URL;
    const maxSteps = parseInt((parsed.values['max-steps'] as string) || '30', 10) || DEFAULT_MAX_STEPS;

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
      customModel,
      customUrl,
      maxSteps,
      help,
      task: taskParts.join(' ').trim(),
    };
  } catch {
    // Fallback parsing
    let autoApprove = process.env.AUTO_APPROVE === 'true';
    let workspaceDir = process.cwd();
    let customModel = process.env.MODEL;
    let customUrl = process.env.OPENAI_BASE_URL;
    let maxSteps = DEFAULT_MAX_STEPS;
    let help = false;
    const taskParts: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-y' || arg === '--auto-approve' || arg === '--yes') {
        autoApprove = true;
      } else if (arg === '-h' || arg === '--help') {
        help = true;
      } else if (arg === '--dir' && i + 1 < args.length) {
        workspaceDir = args[++i];
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
      customModel,
      customUrl,
      maxSteps,
      help,
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
        const badge = event.status === 'ok' ? color.success('✔') : color.error('✖');
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

export const main = async () => {
  const options = parseArgs(process.argv);

  if (options.help) {
    printHelp();
    return;
  }

  const workspace = await Workspace.open(options.workspaceDir);

  const workflows = await loadWorkflows(workspace.root);
  const skills = await loadSkills(workspace.root);

  const providerOptions: Record<string, any> = {};
  if (options.customModel) providerOptions.model = options.customModel;
  if (options.customUrl) providerOptions.baseURL = options.customUrl;

  const provider = createProvider(providerOptions);
  const permissions = createPermissions({ autoApprove: options.autoApprove }, workspace);

  console.log(color.info('=================================================='));
  console.log(color.info('           mini-agent (model-router)             '));
  console.log(color.info('=================================================='));
  console.log(`Workspace : ${workspace.root}`);
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
      permissions.close();
    }
    return;
  }

  // Interactive REPL mode
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const permissionsRepl = createPermissions({ autoApprove: options.autoApprove, rl }, workspace);

  let priorMessages = null;

  console.log(color.info('Interactive session started. Type your task below or "exit" / "quit" to stop.'));
  console.log(color.dim('Type /help to see available workflows.\n'));

  try {
    while (rl) {
      const taskInput = await rl.question(color.cyan('mini-agent > '));
      const trimmed = taskInput.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('Goodbye!');
        break;
      }

      if (trimmed === '/help' || trimmed === '/workflows' || trimmed === '/skills') {
        console.log(color.info('\n--- Workflows ---'));
        if (workflows.length === 0) {
          console.log(color.dim('  (none found)'));
        } else {
          for (const wf of workflows) console.log(color.cyan(`  ${wf.command}`) + ` - ${wf.description}`);
        }
        console.log(color.info('\n--- Skills ---'));
        if (skills.length === 0) {
          console.log(color.dim('  (none found)'));
        } else {
          for (const s of skills) console.log(color.cyan(`  ${s.name}`) + ` - ${s.description}`);
        }
        console.log('');
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
          maxSteps: options.maxSteps,
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
