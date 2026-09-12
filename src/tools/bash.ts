import { runCommand } from '../utils/command.ts';
import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.ts';

export interface BashArgs {
  command: string;
}

export const bashDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'bash',
    description: 'Run a shell command inside the workspace root.',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command line to execute.',
        },
      },
      required: ['command'],
    },
  },
};

export const createBashTool = (env: ToolEnvironment): Tool<BashArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: true,
    trust: TrustKind.COMMAND,
    describe(args) {
      return `run shell command: ${args.command}`;
    },
    async execute(args) {
      const command = args.command;
      return runCommand(command, workspace.root);
    },
    definition: bashDefinition,
  };
};
