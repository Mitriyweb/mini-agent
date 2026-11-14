import fs from 'node:fs';
import path from 'node:path';
import concolor from 'concolor';
import { runAgent } from '../agent.ts';
import { formatQualityGateResults, hasRequiredGateFailure, type QualityGateResult } from '../quality-gates.ts';
import { DurableRun } from '../run-state.ts';
import type { AgentEvent, AgentOptions } from '../../types/agent.ts';
import {
  loadOpenSpecChange,
  markTaskCompleteInFile,
  type OpenSpecChangeContext,
} from './openspec-parser.ts';
import { buildExecutionPlan, type PlannedTask } from './task-planner.ts';
import { selectNextTask, diagnosePlan } from './task-selector.ts';
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
  review?: AgentOptions['review'];
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

  private abortListener?: () => void;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    if (options.maxRetries !== undefined && (!Number.isInteger(options.maxRetries) || options.maxRetries < 0)) {
      throw new Error(`maxRetries must be a non-negative integer, got ${options.maxRetries}`);
    }
    this.maxRetries = options.maxRetries ?? 3;
    this.maxStepsPerTask = options.maxStepsPerTask ?? 30;

    if (options.signal) {
      if (options.signal.aborted) {
        this.interrupted = true;
      } else {
        this.abortListener = () => {
          this.interrupted = true;
        };
        options.signal.addEventListener('abort', this.abortListener, { once: true });
      }
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

    if (plan.totalTasks === 0) {
      throw new Error(`OpenSpec change "${changeName}" contains no executable tasks in tasks.md.`);
    }

    console.log(color.info(`\nOpenSpec Change: ${changeName}`));
    console.log(`Found ${plan.totalTasks} total tasks (${plan.completedTasks} already completed, ${plan.pendingTasks} remaining).\n`);

    const executionResults: TaskExecutionResult[] = [];
    const runAgentFn = this.options.agentRunner ?? runAgent;

    // Step 3-8: Sequential deterministic execution loop
    while (!this.interrupted) {
      // Re-read or re-select next task
      const nextTask = selectNextTask(plan.tasks);
      if (!nextTask) {
        // Check if there are incomplete tasks that are blocked by dependency issues
        const incompleteCount = plan.tasks.filter((t) => !t.completed).length;
        if (incompleteCount > 0) {
          const diagnostic = diagnosePlan(plan.tasks);
          const blockReason = diagnostic.reason ?? 'Remaining tasks are blocked by unsatisfied dependencies.';
          console.log(color.error(`\nExecution blocked: ${blockReason}\n`));
          executionResults.push({
            taskId: 'plan-dependency-error',
            success: false,
            attempts: 0,
            error: blockReason,
          });
        }
        break;
      }

      console.log(color.info(`[${nextTask.index}/${nextTask.total}] ${nextTask.description}`));
      logger?.logNormal(`Starting task ${nextTask.id}: ${nextTask.description}`);

      let taskSuccess = false;
      let attempt = 1;
      const maxAttempts = this.maxRetries + 1;
      let lastError: string | undefined;
      let lastGateResults: QualityGateResult[] | undefined;
      let gateFailuresText: string | undefined;

      while (attempt <= maxAttempts && !this.interrupted) {
        console.log(color.cyan(`Agent execution... (Attempt ${attempt}/${maxAttempts})`));

        // Step 4: Prepare task context
        const taskPrompt = buildTaskPrompt({
          changeContext,
          currentTask: nextTask,
          allTasks: plan.tasks,
          attempt,
          maxAttempts,
          lastError,
          gateFailures: gateFailuresText,
        });

        // Step 5: Execute using existing agent runtime and durable run
        let durableRun: DurableRun | undefined;
        const taskRunRecordFile = path.join(
          workspace.root,
          '.mini-agent',
          'orchestrator',
          changeName,
          `${nextTask.id}.runid`,
        );

        try {
          if (fs.existsSync(taskRunRecordFile)) {
            const recordedRunId = fs.readFileSync(taskRunRecordFile, 'utf8').trim();
            try {
              const candidate = DurableRun.load(workspace.root, recordedRunId);
              if (candidate.state.status === 'interrupted' || candidate.state.status === 'running') {
                candidate.resume();
                durableRun = candidate;
                console.log(color.cyan(`Resuming interrupted durable run: ${durableRun.state.id}`));
              }
            } catch {
              // Could not resume candidate, fallback to create
            }
          }

          if (!durableRun) {
            durableRun = DurableRun.create(
              workspace.root,
              `[OpenSpec ${changeName}] [${nextTask.id}] ${nextTask.description}`,
            );
            fs.mkdirSync(path.dirname(taskRunRecordFile), { recursive: true });
            fs.writeFileSync(taskRunRecordFile, durableRun.state.id, 'utf8');
          }
        } catch {
          // best-effort durable run creation
        }

        let agentError: unknown;
        let agentResult: any;
        try {
          agentResult = await runAgentFn({
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
            review: this.options.review,
            signal: this.options.signal,
          });
        } catch (err) {
          agentError = err;
        }

        // Step 6: Validate result using qualityGateResults returned directly by runAgent
        let gatesPassed = true;
        let qualityGateResults: QualityGateResult[] = agentResult?.qualityGateResults ?? [];
        if (!agentResult && durableRun?.state.qualityGateResults) {
          qualityGateResults = durableRun.state.qualityGateResults;
        }
        lastGateResults = qualityGateResults;

        if (!agentError) {
          if (hasRequiredGateFailure(qualityGateResults)) {
            gatesPassed = false;
            gateFailuresText = formatQualityGateResults(qualityGateResults);
            console.log(color.error(`Tests / Quality Gates: FAIL`));
          } else if (qualityGateResults.length > 0) {
            console.log(color.success(`Tests / Quality Gates: PASS`));
          }
        } else {
          lastError = agentError instanceof Error ? agentError.message : String(agentError);
          if (hasRequiredGateFailure(qualityGateResults)) {
            gateFailuresText = formatQualityGateResults(qualityGateResults);
          }
          console.log(color.error(`Agent execution failed: ${lastError}`));
        }

        const reviewOutcome = agentResult?.reviewOutcome;
        if (reviewOutcome && reviewOutcome.verdict !== 'pass') {
          taskSuccess = false;
          console.log(color.error(`Review verdict: ${reviewOutcome.verdict}`));
          console.log(color.error(reviewOutcome.findings));
          lastError = `Review verdict: ${reviewOutcome.verdict} - ${reviewOutcome.findings}`;
        }

        if (!agentError && gatesPassed && (!reviewOutcome || reviewOutcome.verdict === 'pass')) {
          // Success!
          taskSuccess = true;
          console.log(color.success(`Task completed\n`));

          // Step 7: Update OpenSpec progress only after successful validation
          await markTaskCompleteInFile(changeContext.tasksFilePath, nextTask.id, true);
          nextTask.completed = true;
          try {
            if (fs.existsSync(taskRunRecordFile)) {
              fs.unlinkSync(taskRunRecordFile);
            }
          } catch {
            // ignore
          }
          plan = buildExecutionPlan(plan.tasks);
          break;
        }

        if (this.interrupted) {
          durableRun?.interrupt();
          break;
        }

        // Failure handling & retry
        attempt++;
        if (attempt <= maxAttempts && !this.interrupted) {
          const retryNum = attempt - 1;
          console.log(color.warn(`Retry ${retryNum}/${this.maxRetries}...`));
        }
      }

      const executedAttempts = taskSuccess
        ? attempt
        : this.interrupted
          ? attempt
          : maxAttempts;

      executionResults.push({
        taskId: nextTask.id,
        success: taskSuccess,
        attempts: executedAttempts,
        error: taskSuccess ? undefined : (lastError || gateFailuresText),
        qualityGateResults: lastGateResults,
      });

      if (!taskSuccess) {
        if (this.interrupted) {
          console.log(color.warn(`\nExecution stopped due to interruption.`));
        } else {
          console.log(color.error(`\nTask ${nextTask.id} failed after ${maxAttempts} attempts (${this.maxRetries} retries). Stopping execution.\n`));
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

    if (this.options.signal && this.abortListener) {
      this.options.signal.removeEventListener('abort', this.abortListener);
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
