import concolor from 'concolor';
import { runAgent } from '../agent.ts';
import { executeQualityGates, formatQualityGateResults, hasRequiredGateFailure, type QualityGateResult } from '../quality-gates.ts';
import { DurableRun } from '../run-state.ts';
import type { AgentEvent, AgentOptions } from '../../types/agent.ts';
import {
  loadOpenSpecChange,
  markTaskCompleteInFile,
  type OpenSpecChangeContext,
} from './openspec-parser.ts';
import { buildExecutionPlan, type PlannedTask } from './task-planner.ts';
import { selectNextTask } from './task-selector.ts';
import { buildTaskPrompt } from './task-context.ts';

const color = (concolor as any)({
  info: 'b,blue',
  warn: 'b,yellow',
  error: 'b,red',
  success: 'b,green',
  cyan: 'b,cyan',
  dim: 'gray',
});

export interface OrchestratorOptions {
  workspace: AgentOptions['workspace'];
  changeName: string;
  provider: AgentOptions['provider'];
  permissions: AgentOptions['permissions'];
  maxRetries?: number;
  maxStepsPerTask?: number;
  onEvent?: AgentOptions['onEvent'];
  workflows?: AgentOptions['workflows'];
  skills?: AgentOptions['skills'];
  logging?: AgentOptions['logging'];
  costTracking?: AgentOptions['costTracking'];
  skillsConfig?: AgentOptions['skillsConfig'];
  systemPromptConfig?: AgentOptions['systemPromptConfig'];
  logger?: AgentOptions['logger'];
  usageTracker?: AgentOptions['usageTracker'];
  qualityGates?: AgentOptions['qualityGates'];
  signal?: AbortSignal;
  /** Optional runner override for tests/mocks */
  agentRunner?: (options: AgentOptions) => Promise<any>;
}

export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  attempts: number;
  error?: string;
  qualityGateResults?: QualityGateResult[];
}

export interface OrchestrationResult {
  changeName: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  success: boolean;
  results: TaskExecutionResult[];
}

export class OpenSpecOrchestrator {
  private options: OrchestratorOptions;
  private maxRetries: number;
  private maxStepsPerTask: number;
  private interrupted = false;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxStepsPerTask = options.maxStepsPerTask ?? 30;

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        this.interrupted = true;
      });
    }
  }

  public cancel(): void {
    this.interrupted = true;
  }

  public async run(): Promise<OrchestrationResult> {
    const { workspace, changeName } = this.options;
    const logger = this.options.logger;

    // Step 1: Load OpenSpec change
    const changeContext = await loadOpenSpecChange(workspace.root, changeName);

    // Step 2: Build execution plan
    let plan = buildExecutionPlan(changeContext.tasks);

    console.log(color.info(`\nOpenSpec Change: ${changeName}`));
    console.log(`Found ${plan.totalTasks} total tasks (${plan.completedTasks} already completed, ${plan.pendingTasks} remaining).\n`);

    const executionResults: TaskExecutionResult[] = [];
    const runAgentFn = this.options.agentRunner ?? runAgent;

    // Step 3-8: Sequential deterministic execution loop
    while (!this.interrupted) {
      // Re-read or re-select next task
      const nextTask = selectNextTask(plan.tasks);
      if (!nextTask) {
        // No incomplete tasks with satisfied dependencies
        break;
      }

      console.log(color.info(`[${nextTask.index}/${nextTask.total}] ${nextTask.description}`));
      logger?.logNormal(`Starting task ${nextTask.id}: ${nextTask.description}`);

      let taskSuccess = false;
      let attempt = 1;
      let lastError: string | undefined;
      let lastGateResults: QualityGateResult[] | undefined;
      let gateFailuresText: string | undefined;

      while (attempt <= this.maxRetries && !this.interrupted) {
        console.log(color.cyan(`Agent execution... (Attempt ${attempt}/${this.maxRetries})`));

        // Step 4: Prepare task context
        const taskPrompt = buildTaskPrompt({
          changeContext,
          currentTask: nextTask,
          allTasks: plan.tasks,
          attempt,
          maxAttempts: this.maxRetries,
          lastError,
          gateFailures: gateFailuresText,
        });

        // Step 5: Execute using existing agent runtime and durable run
        let durableRun: DurableRun | undefined;
        try {
          durableRun = DurableRun.create(
            workspace.root,
            `[OpenSpec ${changeName}] [${nextTask.id}] ${nextTask.description}`,
          );
        } catch {
          // best-effort durable run creation
        }

        let agentError: unknown;
        try {
          await runAgentFn({
            task: taskPrompt,
            provider: this.options.provider,
            permissions: this.options.permissions,
            workspace: this.options.workspace,
            maxSteps: this.maxStepsPerTask,
            onEvent: this.options.onEvent,
            workflows: this.options.workflows,
            skills: this.options.skills,
            logging: this.options.logging,
            costTracking: this.options.costTracking,
            skillsConfig: this.options.skillsConfig,
            systemPromptConfig: this.options.systemPromptConfig,
            logger: this.options.logger,
            usageTracker: this.options.usageTracker,
            durableRun,
            qualityGates: this.options.qualityGates,
          });
        } catch (err) {
          agentError = err;
        }

        // Step 6: Validate result
        let gatesPassed = true;
        let qualityGateResults: QualityGateResult[] = [];

        if (!agentError) {
          try {
            qualityGateResults = await executeQualityGates({
              config: this.options.qualityGates ?? { enabled: false, gates: [] },
              workspace,
              permissions: this.options.permissions,
            });
            lastGateResults = qualityGateResults;

            if (hasRequiredGateFailure(qualityGateResults)) {
              gatesPassed = false;
              gateFailuresText = formatQualityGateResults(qualityGateResults);
              console.log(color.error(`Tests / Quality Gates: FAIL`));
            } else if (qualityGateResults.length > 0) {
              console.log(color.success(`Tests / Quality Gates: PASS`));
            }
          } catch (gateErr) {
            gatesPassed = false;
            gateFailuresText = String(gateErr);
            console.log(color.error(`Quality Gates Error: ${gateErr}`));
          }
        } else {
          lastError = agentError instanceof Error ? agentError.message : String(agentError);
          console.log(color.error(`Agent execution failed: ${lastError}`));
        }

        if (!agentError && gatesPassed) {
          // Success!
          taskSuccess = true;
          console.log(color.success(`Task completed\n`));

          // Step 7: Update OpenSpec progress only after successful validation
          await markTaskCompleteInFile(changeContext.tasksFilePath, nextTask.id, true);
          nextTask.completed = true;
          plan = buildExecutionPlan(plan.tasks);
          break;
        }

        if (this.interrupted) {
          durableRun?.interrupt();
          break;
        }

        // Failure handling & retry
        attempt++;
        if (attempt <= this.maxRetries && !this.interrupted) {
          console.log(color.warn(`Retry ${attempt}/${this.maxRetries}...`));
        }
      }

      executionResults.push({
        taskId: nextTask.id,
        success: taskSuccess,
        attempts: Math.min(attempt, this.maxRetries),
        error: taskSuccess ? undefined : (lastError || gateFailuresText),
        qualityGateResults: lastGateResults,
      });

      if (!taskSuccess) {
        if (this.interrupted) {
          console.log(color.warn(`\nExecution stopped due to interruption.`));
        } else {
          console.log(color.error(`\nTask ${nextTask.id} failed after ${this.maxRetries} attempts. Stopping execution.\n`));
        }
        break;
      }
    }

    const completedCount = plan.tasks.filter((t) => t.completed).length;
    const failedCount = plan.tasks.length - completedCount;
    const overallSuccess = completedCount === plan.totalTasks && !this.interrupted;

    if (overallSuccess) {
      console.log(color.success(`All ${plan.totalTasks} tasks completed successfully for change "${changeName}".`));
    } else {
      console.log(color.warn(`Execution ended: ${completedCount}/${plan.totalTasks} tasks complete.`));
    }

    return {
      changeName,
      totalTasks: plan.totalTasks,
      completedTasks: completedCount,
      failedTasks: failedCount,
      success: overallSuccess,
      results: executionResults,
    };
  }
}
