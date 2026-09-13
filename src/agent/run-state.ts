import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { redactSecrets, AuditLogger } from './logging.ts';
import type { UsageSummary } from './usage-tracker.ts';
import type { QualityGateResult } from './quality-gates.ts';

export type RunStatus = 'running' | 'interrupted' | 'failed' | 'completed';

export interface CompletedToolCall {
  id: string;
  output: string;
}

export interface RunState {
  version: 1;
  id: string;
  task: string;
  workspace: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  currentStep: number;
  lastEventPosition: number;
  messages: ChatCompletionMessageParam[];
  completedToolCalls: CompletedToolCall[];
  qualityGateResults?: QualityGateResult[];
  usageSummary?: UsageSummary;
  error?: string;
}

const stateFileName = 'state.json';
const eventsFileName = 'events.jsonl';

const safe = <T>(value: T): T => redactSecrets(value) as T;

export class DurableRun {
  public readonly directory: string;
  public state: RunState;

  private constructor(directory: string, state: RunState) {
    this.directory = directory;
    this.state = state;
  }

  public static create(workspace: string, task: string): DurableRun {
    const id = randomUUID();
    const directory = path.join(workspace, '.mini-agent', 'runs', id);
    const now = new Date().toISOString();
    const state: RunState = {
      version: 1,
      id,
      task: safe(task),
      workspace: path.resolve(workspace),
      status: 'running',
      createdAt: now,
      updatedAt: now,
      currentStep: 0,
      lastEventPosition: 0,
      messages: [],
      completedToolCalls: [],
    };
    fs.mkdirSync(directory, { recursive: true });
    const run = new DurableRun(directory, state);
    new AuditLogger(workspace).logEvent(id, 'run_start', { task });
    run.writeState();
    run.appendEvent('created', { task: state.task, workspace: state.workspace });
    return run;
  }

  public static load(workspace: string, runId: string): DurableRun {
    if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error('Invalid run ID.');
    const directory = path.join(workspace, '.mini-agent', 'runs', runId);
    const statePath = path.join(directory, stateFileName);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (error) {
      throw new Error(`Unable to load run '${runId}': invalid or missing state.json (${error instanceof Error ? error.message : error}).`);
    }
    if (!DurableRun.isValidState(parsed, runId, workspace)) {
      throw new Error(`Unable to resume run '${runId}': state.json is invalid or belongs to another workspace.`);
    }
    const run = new DurableRun(directory, parsed);
    if (run.state.status === 'completed') {
      throw new Error(`Run '${runId}' is already completed and cannot be resumed.`);
    }
    return run;
  }

  private static isValidState(value: unknown, runId: string, workspace: string): value is RunState {
    const state = value as Partial<RunState> | null;
    return Boolean(
      state && state.version === 1 && state.id === runId && state.workspace === path.resolve(workspace) &&
      typeof state.task === 'string' && ['running', 'interrupted', 'failed', 'completed'].includes(state.status as string) &&
      Array.isArray(state.messages) && Array.isArray(state.completedToolCalls) &&
      typeof state.currentStep === 'number' && typeof state.lastEventPosition === 'number',
    );
  }

  public resume(): void {
    this.state.status = 'running';
    delete this.state.error;
    new AuditLogger(this.state.workspace).logEvent(this.state.id, 'run_resume', { task: this.state.task });
    this.persist('resumed');
  }

  public update(step: number, messages: ChatCompletionMessageParam[]): void {
    this.state.currentStep = step;
    this.state.messages = safe(messages);
    this.persist('checkpoint', { step });
  }

  public recordToolResult(id: string, output: string): void {
    if (!this.state.completedToolCalls.some((call) => call.id === id)) {
      this.state.completedToolCalls.push({ id, output: safe(output) });
    }
    this.persist('tool-completed', { id });
  }

  public completedToolOutput(id: string): string | undefined {
    return this.state.completedToolCalls.find((call) => call.id === id)?.output;
  }

  public complete(messages: ChatCompletionMessageParam[], metadata: { qualityGateResults?: QualityGateResult[]; usageSummary?: UsageSummary } = {}): void {
    this.state.status = 'completed';
    this.state.messages = safe(messages);
    this.state.qualityGateResults = safe(metadata.qualityGateResults);
    this.state.usageSummary = safe(metadata.usageSummary);
    new AuditLogger(this.state.workspace).logEvent(this.state.id, 'run_complete', metadata);
    this.persist('completed');
  }

  public fail(error: unknown, messages: ChatCompletionMessageParam[], metadata: { qualityGateResults?: QualityGateResult[]; usageSummary?: UsageSummary } = {}): void {
    this.state.status = 'failed';
    this.state.error = safe(error instanceof Error ? error.message : String(error));
    this.state.messages = safe(messages);
    this.state.qualityGateResults = safe(metadata.qualityGateResults);
    this.state.usageSummary = safe(metadata.usageSummary);
    new AuditLogger(this.state.workspace).logEvent(this.state.id, 'run_fail', { error: this.state.error, ...metadata });
    this.persist('failed', { error: this.state.error });
  }

  public interrupt(): void {
    if (this.state.status !== 'running') return;
    this.state.status = 'interrupted';
    new AuditLogger(this.state.workspace).logEvent(this.state.id, 'run_interrupt', {});
    this.persist('interrupted');
  }

  private persist(type: string, data?: Record<string, unknown>): void {
    this.state.updatedAt = new Date().toISOString();
    this.writeState();
    this.appendEvent(type, data);
    if (this.state.status !== 'running') this.writeReports();
  }

  private writeReports(): void {
    try {
      const result = safe({
        version: 1,
        runId: this.state.id,
        status: this.state.status,
        task: this.state.task,
        workspace: this.state.workspace,
        createdAt: this.state.createdAt,
        updatedAt: this.state.updatedAt,
        currentStep: this.state.currentStep,
        completedToolSteps: this.state.completedToolCalls.map((call) => call.id),
        filesChanged: [],
        qualityGates: this.state.qualityGateResults ?? [],
        usage: this.state.usageSummary ?? null,
        error: this.state.error ?? null,
      });
      fs.writeFileSync(path.join(this.directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');

      const gateLines = this.state.qualityGateResults?.length
        ? this.state.qualityGateResults.map((gate) => `- ${gate.required ? 'Required' : 'Optional'} **${gate.name}**: ${gate.status}${gate.reason ? ` (${gate.reason})` : ''}`)
        : ['- No quality-gate results recorded.'];
      const usage = this.state.usageSummary;
      const usageLines = usage
        ? [`- Requests: ${usage.requests}`, `- Tokens: ${usage.totalTokens}`, `- Estimated cost: ${usage.currency} ${usage.estimatedCost}`]
        : ['- Usage data unavailable.'];
      const report = [
        '# Run Report',
        '',
        `- **Run ID:** ${this.state.id}`,
        `- **Status:** ${this.state.status}`,
        `- **Task:** ${this.state.task}`,
        `- **Created:** ${this.state.createdAt}`,
        `- **Updated:** ${this.state.updatedAt}`,
        '',
        '## Files Changed',
        '- No file-change metadata recorded.',
        '',
        '## Quality Gates',
        ...gateLines,
        '',
        '## Usage',
        ...usageLines,
        ...(this.state.error ? ['', '## Error', this.state.error] : []),
        '',
      ].join('\n');
      fs.writeFileSync(path.join(this.directory, 'report.md'), `${safe(report)}\n`, 'utf8');
    } catch {
      // Reports are observability artifacts; never replace the run outcome.
    }
  }

  private writeState(): void {
    fs.writeFileSync(path.join(this.directory, stateFileName), `${JSON.stringify(safe(this.state), null, 2)}\n`, 'utf8');
  }

  private appendEvent(type: string, data?: Record<string, unknown>): void {
    this.state.lastEventPosition += 1;
    const event = safe({ position: this.state.lastEventPosition, type, at: new Date().toISOString(), ...data });
    fs.appendFileSync(path.join(this.directory, eventsFileName), `${JSON.stringify(event)}\n`, 'utf8');
    this.writeState();
  }
}
