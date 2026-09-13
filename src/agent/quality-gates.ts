import fs from 'node:fs';
import path from 'node:path';
import { runCommandDetailed } from '../utils/command.ts';
import { createBashTool } from '../tools/bash.ts';
import type { Permissions } from '../types/permissions.ts';
import type { Workspace } from './workspace.ts';

export interface QualityGateDefinition {
  id: string;
  name: string;
  command?: string;
  required: boolean;
  timeoutMs?: number;
}

export interface QualityGatesConfig {
  enabled: boolean;
  gates: QualityGateDefinition[];
}

export type QualityGateStatus = 'passed' | 'failed' | 'skipped';

export interface QualityGateResult {
  id: string;
  name: string;
  command?: string;
  required: boolean;
  status: QualityGateStatus;
  exitCode?: number | 'timeout' | 'error';
  stdout: string;
  stderr: string;
  durationMs: number;
  reason?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const normalizeQualityGatesConfig = (value: unknown): QualityGatesConfig => {
  if (value === undefined) return { enabled: false, gates: [] };
  if (!isRecord(value)) throw new Error('quality_gates must be an object.');
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new Error('quality_gates.enabled must be a boolean.');
  }
  if (value.gates !== undefined && !Array.isArray(value.gates)) {
    throw new Error('quality_gates.gates must be an array.');
  }

  const ids = new Set<string>();
  const gates = (value.gates ?? []).map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`quality_gates.gates[${index}] must be an object.`);
    const id = entry.id;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error(`quality_gates.gates[${index}].id must be a kebab-case identifier.`);
    }
    if (ids.has(id)) throw new Error(`quality_gates contains duplicate gate id '${id}'.`);
    ids.add(id);
    if (entry.name !== undefined && (typeof entry.name !== 'string' || !entry.name.trim())) {
      throw new Error(`quality_gates.gates[${index}].name must be a non-empty string.`);
    }
    if (entry.command !== undefined && (typeof entry.command !== 'string' || !entry.command.trim())) {
      throw new Error(`quality_gates.gates[${index}].command must be a non-empty string when provided.`);
    }
    if (entry.required !== undefined && typeof entry.required !== 'boolean') {
      throw new Error(`quality_gates.gates[${index}].required must be a boolean.`);
    }
    if (entry.timeout_ms !== undefined && (!Number.isSafeInteger(entry.timeout_ms) || (entry.timeout_ms as number) < 1)) {
      throw new Error(`quality_gates.gates[${index}].timeout_ms must be a positive integer.`);
    }
    const required = entry.required ?? true;
    const command = typeof entry.command === 'string' ? entry.command.trim() : undefined;
    if (required && !command) throw new Error(`Required quality gate '${id}' must define a command.`);
    return {
      id,
      name: typeof entry.name === 'string' ? entry.name.trim() : id,
      command,
      required,
      timeoutMs: entry.timeout_ms as number | undefined,
    };
  });

  return { enabled: value.enabled ?? true, gates };
};

export const discoverQualityGates = (workspaceRoot: string): QualityGateDefinition[] => {
  const packagePath = path.join(workspaceRoot, 'package.json');
  try {
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { scripts?: Record<string, unknown> };
    return ['test', 'check', 'build', 'verify']
      .filter((id) => typeof packageJson.scripts?.[id] === 'string')
      .map((id) => ({ id, name: id, command: `bun run ${id}`, required: true }));
  } catch {
    return [];
  }
};

export const executeQualityGates = async ({
  config,
  workspace,
  permissions,
}: {
  config: QualityGatesConfig;
  workspace: Workspace;
  permissions: Permissions;
}): Promise<QualityGateResult[]> => {
  if (!config.enabled) return [];
  const gates = config.gates.length > 0 ? config.gates : discoverQualityGates(workspace.root);
  const bashTool = createBashTool({ workspace });
  const results: QualityGateResult[] = [];

  for (const gate of gates) {
    if (!gate.command) {
      results.push({ ...gate, status: 'skipped', stdout: '', stderr: '', durationMs: 0, reason: 'No command configured.' });
      continue;
    }
    const approved = await permissions.approve(bashTool, { command: gate.command });
    if (!approved) {
      results.push({
        ...gate,
        status: gate.required ? 'failed' : 'skipped',
        exitCode: 'error', stdout: '', stderr: '', durationMs: 0,
        reason: 'Command was not approved.',
      });
      continue;
    }
    const execution = await runCommandDetailed(gate.command, workspace.root, gate.timeoutMs);
    results.push({
      ...gate,
      status: execution.exitCode === 0 ? 'passed' : 'failed',
      ...execution,
    });
  }
  return results;
};

export const hasRequiredGateFailure = (results: QualityGateResult[]): boolean =>
  results.some((result) => result.required && result.status === 'failed');

export const formatQualityGateResults = (results: QualityGateResult[]): string => {
  if (results.length === 0) return 'No quality gates were configured.';
  return results.map((result) => {
    const detail = result.reason ?? (result.exitCode === undefined ? '' : ` (exit: ${result.exitCode})`);
    return `${result.required ? 'required' : 'optional'} gate '${result.id}': ${result.status}${detail}`;
  }).join('\n');
};
