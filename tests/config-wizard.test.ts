import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';

import { parseArgs, parseConfigWizardCommand, ParsedCommand } from '../src/start.ts';
import { createCompleter } from '../src/agent/completer.ts';
import { runConfigWizard, WIZARD_FIELDS, WIZARD_DEFAULT_FILE_CONFIG } from '../src/agent/config-wizard.ts';
import { loadConfigFile, resolveAgentConfig, resolveUserConfigDir } from '../src/agent/config.ts';

let tmpDir: string;
let userConfigHome: string;
let originalXdg: string | undefined;

beforeEach(() => {
  originalXdg = process.env.XDG_CONFIG_HOME;
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-wizard-test-'));
  userConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'config-wizard-user-test-'));
  process.env.XDG_CONFIG_HOME = userConfigHome;
});

afterEach(() => {
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(userConfigHome, { recursive: true, force: true });
});

const silentLog = () => {};
const emptyAsk = async () => '';

const askWith = (answers: Record<string, string[]>) => {
  const counts = new Map<string, number>();
  return async (prompt: string): Promise<string> => {
    for (const [key, values] of Object.entries(answers)) {
      if (prompt.includes(key)) {
        const idx = counts.get(key) ?? 0;
        counts.set(key, idx + 1);
        return values[Math.min(idx, values.length - 1)] ?? '';
      }
    }
    return '';
  };
};

describe('parseArgs: config command', () => {
  it('parses `config` as a command', () => {
    const opts = parseArgs(['node', 'mini-agent', 'config']);
    expect(opts.command).toBe(ParsedCommand.Config);
    expect(opts.task).toBe('');
  });

  it('parses config wizard flags', () => {
    const opts = parseArgs(['node', 'mini-agent', 'config', '--defaults', '--dry-run', '--force', '--format', 'json', '--config', 'custom.yaml']);
    expect(opts.command).toBe(ParsedCommand.Config);
    expect(opts.configDefaults).toBe(true);
    expect(opts.configDryRun).toBe(true);
    expect(opts.configForce).toBe(true);
    expect(opts.configFormat).toBe('json');
    expect(opts.configPath).toBe('custom.yaml');
  });

  it('parses config wizard scope flags', () => {
    expect(parseArgs(['node', 'mini-agent', 'config', '--user']).configScope).toBe('user');
    expect(parseArgs(['node', 'mini-agent', 'config', '--workspace']).configScope).toBe('workspace');
    expect(parseArgs(['node', 'mini-agent', 'config']).configScope).toBeUndefined();
  });

  it('does not break normal task parsing', () => {
    const opts = parseArgs(['node', 'mini-agent', 'fix the bug']);
    expect(opts.command).toBeUndefined();
    expect(opts.task).toBe('fix the bug');
  });
});

describe('parseConfigWizardCommand: REPL /config', () => {
  it('is suggested by slash-command autocompletion', () => {
    const completer = createCompleter({ workspaceRoot: tmpDir });
    const [hits] = completer('/con');
    expect(hits).toContain('/config');
  });

  it('recognizes /config with optional scope flags', () => {
    expect(parseConfigWizardCommand('/config')).toEqual({ kind: 'run' });
    expect(parseConfigWizardCommand('  /config  ')).toEqual({ kind: 'run' });
    expect(parseConfigWizardCommand('/config --user')).toEqual({ kind: 'run', scope: 'user' });
    expect(parseConfigWizardCommand('/config --workspace')).toEqual({ kind: 'run', scope: 'workspace' });
    expect(parseConfigWizardCommand('/config --workspace --user')).toEqual({ kind: 'run', scope: 'user' });
  });

  it('rejects unknown arguments and ignores unrelated input', () => {
    expect(parseConfigWizardCommand('/config --defaults')).toEqual({ kind: 'invalid' });
    expect(parseConfigWizardCommand('/config --bogus')).toEqual({ kind: 'invalid' });
    expect(parseConfigWizardCommand('/configuration')).toEqual({ kind: 'none' });
    expect(parseConfigWizardCommand('config')).toEqual({ kind: 'none' });
  });
});

describe('runConfigWizard', () => {
  it('--defaults prints a commented template that loads cleanly', async () => {
    const result = await runConfigWizard({ workspaceDir: tmpDir, scope: 'workspace', defaultsOnly: true, log: silentLog });
    expect(result.wrote).toBe(false);
    expect(result.content).toContain('logging:');
    expect(result.content).toContain('permission_mode:');
    expect(result.content).toContain('subagents:');
    expect(result.content).toContain('quality_gates:');
    expect(result.content).toContain('external_review:');
    expect(result.content).toContain('providers:');
    expect(result.content).toContain('#');
    // logging defaults to off in wizard output
    const parsed = parseYaml(result.content) as any;
    expect(parsed.logging.level).toBe('off');
    // round-trips through the real config pipeline
    const resolved = resolveAgentConfig({ configPath: result.path }, tmpDir);
    expect(resolved.permissionMode).toBe('normal');
  });

  it('interactive run with empty answers writes wizard defaults', async () => {
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: emptyAsk,
      log: silentLog,
    });
    expect(result.wrote).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'mini-agent.config.yaml'))).toBe(true);
    const resolved = resolveAgentConfig({}, tmpDir);
    expect(resolved.logging.level).toBe('off');
    expect(resolved.permissionMode).toBe('normal');
    expect(resolved.subagents.enabled).toBe(false);
  });

  it('applies answers, re-prompts on invalid input, and normalizes aliases', async () => {
    const ask = askWith({
      'logging.level': ['bogus', 'verbose'],
      'permission_mode': ['yolo'],
      'skills.allow': ['git, code-review'],
      'subagents.enabled': ['true'],
      'subagents.max_concurrency': ['2'],
      'quality_gates.gates': ['[{"id":"lint","command":"bun run lint","required":true}]'],
      'providers': ['{"llmlite":{"baseURL":"https://llm.example.com/v1","defaultModel":"auto","apiKeyEnvVar":"LLMLITE_API_KEY"}}'],
    });
    const result = await runConfigWizard({ workspaceDir: tmpDir, scope: 'workspace', ask, log: silentLog });
    expect(result.wrote).toBe(true);
    const resolved = resolveAgentConfig({}, tmpDir);
    expect(resolved.logging.level).toBe('verbose');
    expect(resolved.permissionMode).toBe('bypass');
    expect(resolved.skills.allow).toEqual(['git', 'code-review']);
    expect(resolved.subagents.enabled).toBe(true);
    expect(resolved.subagents.maxConcurrency).toBe(2);
    expect(resolved.qualityGates.gates[0]?.id).toBe('lint');
    expect(resolved.customProviders.llmlite?.defaultModel).toBe('auto');
  });

  it('rejects invalid JSON for complex fields until valid input is given', async () => {
    const ask = askWith({
      'external_review.retries': ['{bad json', '{"maxAttempts":5}'],
    });
    const result = await runConfigWizard({ workspaceDir: tmpDir, scope: 'workspace', ask, log: silentLog });
    expect(result.wrote).toBe(true);
    const fileConfig = loadConfigFile(tmpDir);
    expect(fileConfig.external_review?.retries?.maxAttempts).toBe(5);
  });

  it('pre-fills from an existing config file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'mini-agent.config.yaml'),
      'logging:\n  level: verbose\npermission_mode: bypass\n',
    );
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: emptyAsk,
      force: true,
      log: silentLog,
    });
    expect(result.wrote).toBe(true);
    const fileConfig = loadConfigFile(tmpDir);
    expect(fileConfig.logging?.level).toBe('verbose');
    expect(fileConfig.permission_mode).toBe('bypass');
    // untouched defaults still applied
    expect(fileConfig.subagents?.enabled).toBe(false);
  });

  it('asks before overwriting and aborts on decline', async () => {
    const target = path.join(tmpDir, 'mini-agent.config.yaml');
    fs.writeFileSync(target, 'logging:\n  level: verbose\n');
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: askWith({ 'already exists': ['n'] }),
      log: silentLog,
    });
    expect(result.aborted).toBe(true);
    expect(result.wrote).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toContain('verbose');
  });

  it('--force overwrites without confirmation', async () => {
    const target = path.join(tmpDir, 'mini-agent.config.yaml');
    fs.writeFileSync(target, 'logging:\n  level: verbose\n');
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: emptyAsk,
      force: true,
      log: silentLog,
    });
    expect(result.wrote).toBe(true);
    const resolved = resolveAgentConfig({}, tmpDir);
    // existing values are kept on empty input (pre-fill behavior)
    expect(resolved.logging.level).toBe('verbose');
    expect(fs.readFileSync(result.path, 'utf8')).toContain('subagents:');
  });

  it('--dry-run prints content without writing', async () => {
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: emptyAsk,
      dryRun: true,
      log: silentLog,
    });
    expect(result.wrote).toBe(false);
    expect(result.content).toContain('logging:');
    expect(fs.existsSync(path.join(tmpDir, 'mini-agent.config.yaml'))).toBe(false);
  });

  it('--config selects a custom target path and .json implies json format', async () => {
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      targetPath: 'nested/custom.json',
      ask: emptyAsk,
      log: silentLog,
    });
    expect(result.format).toBe('json');
    expect(result.wrote).toBe(true);
    const written = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(written.logging.level).toBe('off');
    expect(written.providers).toEqual({});
    const resolved = resolveAgentConfig({ configPath: 'nested/custom.json' }, tmpDir);
    expect(resolved.logging.level).toBe('off');
  });

  it('produces output that fails loudly on invalid semantic values', async () => {
    // quality_gates gate with required:true but no command must fail validation
    const ask = askWith({
      'quality_gates.gates': ['[{"id":"bad","required":true}]', ''],
    });
    // field-level validation rejects it; empty answer keeps []
    const result = await runConfigWizard({ workspaceDir: tmpDir, scope: 'workspace', ask, log: silentLog });
    expect(result.wrote).toBe(true);
    const fileConfig = loadConfigFile(tmpDir);
    expect(fileConfig.quality_gates?.gates ?? []).toEqual([]);
  });
  it('--config overrides the scope target', async () => {
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'user',
      targetPath: 'explicit.yaml',
      ask: emptyAsk,
      log: silentLog,
    });
    expect(result.path).toBe(path.join(tmpDir, 'explicit.yaml'));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('user scope writes under the user config dir without prompting for scope', async () => {
    const prompts: string[] = [];
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'user',
      ask: async (prompt) => {
        prompts.push(prompt);
        return '';
      },
      log: silentLog,
    });

    const target = path.join(resolveUserConfigDir(), 'mini-agent.config.yaml');
    expect(result.path).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Config scope'))).toBe(false);
  });

  it('workspace scope writes to the workspace root without prompting for scope', async () => {
    const prompts: string[] = [];
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      ask: async (prompt) => {
        prompts.push(prompt);
        return '';
      },
      log: silentLog,
    });

    expect(result.path).toBe(path.join(tmpDir, 'mini-agent.config.yaml'));
    expect(fs.existsSync(result.path)).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('Config scope'))).toBe(false);
  });

  it('interactive scope prompt preselects the user config', async () => {
    const result = await runConfigWizard({ workspaceDir: tmpDir, ask: emptyAsk, log: silentLog });
    expect(result.path).toBe(path.join(resolveUserConfigDir(), 'mini-agent.config.yaml'));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('interactive scope prompt honors a workspace answer', async () => {
    const ask = async (prompt: string) => (prompt.includes('Config scope') ? '2' : '');
    const result = await runConfigWizard({ workspaceDir: tmpDir, ask, log: silentLog });
    expect(result.path).toBe(path.join(tmpDir, 'mini-agent.config.yaml'));
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it('--defaults reports the scoped target', async () => {
    const logs: string[] = [];
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'workspace',
      defaultsOnly: true,
      log: (message) => logs.push(message),
    });
    const target = path.join(tmpDir, 'mini-agent.config.yaml');
    expect(result.path).toBe(target);
    expect(logs.join('\n')).toContain(target);
  });

  it('--dry-run reports the scoped target without writing', async () => {
    const logs: string[] = [];
    const result = await runConfigWizard({
      workspaceDir: tmpDir,
      scope: 'user',
      dryRun: true,
      ask: emptyAsk,
      log: (message) => logs.push(message),
    });
    const target = path.join(resolveUserConfigDir(), 'mini-agent.config.yaml');
    expect(result.path).toBe(target);
    expect(logs.join('\n')).toContain(target);
    expect(fs.existsSync(target)).toBe(false);
  });
});

describe('example config coverage', () => {
  it('every top-level key in mini-agent.config.example.yaml is covered by wizard fields', () => {
    const examplePath = path.join(import.meta.dir, '..', 'mini-agent.config.example.yaml');
    const example = parseYaml(fs.readFileSync(examplePath, 'utf8')) as Record<string, unknown>;
    const coveredRoots = new Set(WIZARD_FIELDS.map((f) => f.path[0] as string));
    for (const key of Object.keys(example)) {
      expect(coveredRoots.has(key)).toBe(true);
    }
  });

  it('wizard defaults cover every documented section', () => {
    const defaults = WIZARD_DEFAULT_FILE_CONFIG as Record<string, unknown>;
    for (const key of ['logging', 'cost_tracking', 'skills', 'system_prompt', 'permission_mode', 'retry', 'external_review', 'subagents', 'quality_gates']) {
      expect(defaults[key]).toBeDefined();
    }
  });
});
