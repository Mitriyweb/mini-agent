import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { deepMergeFileConfigs, resolveAgentConfig, resolveUserConfigDir } from '../src/agent/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Configuration Precedence Test Suite (defaults < user file < workspace file < env < CLI)', () => {
  let tempDir: string;
  let userConfigHome: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-config-test-'));
    userConfigHome = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-user-config-test-'));
    originalEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      LOG_LEVEL: process.env.LOG_LEVEL,
      MINI_AGENT_LOG_LEVEL: process.env.MINI_AGENT_LOG_LEVEL,
      MINI_AGENT_COST_TRACKING: process.env.MINI_AGENT_COST_TRACKING,
      MINI_AGENT_SKILLS_ENABLED: process.env.MINI_AGENT_SKILLS_ENABLED,
      MINI_AGENT_SYSTEM_PROMPT_ENABLED: process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED,
      MINI_AGENT_SUBAGENTS_ENABLED: process.env.MINI_AGENT_SUBAGENTS_ENABLED,
      MINI_AGENT_SUBAGENTS_MAX_CONCURRENCY: process.env.MINI_AGENT_SUBAGENTS_MAX_CONCURRENCY,
      MINI_AGENT_SUBAGENTS_MAX_STEPS: process.env.MINI_AGENT_SUBAGENTS_MAX_STEPS,
      MINI_AGENT_SUBAGENTS_ALLOW_NESTED: process.env.MINI_AGENT_SUBAGENTS_ALLOW_NESTED,
      MINI_AGENT_PERMISSION_MODE: process.env.MINI_AGENT_PERMISSION_MODE,
    };
    process.env.XDG_CONFIG_HOME = userConfigHome;
    delete process.env.LOG_LEVEL;
    delete process.env.MINI_AGENT_LOG_LEVEL;
    delete process.env.MINI_AGENT_COST_TRACKING;
    delete process.env.MINI_AGENT_SKILLS_ENABLED;
    delete process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED;
    delete process.env.MINI_AGENT_SUBAGENTS_ENABLED;
    delete process.env.MINI_AGENT_SUBAGENTS_MAX_CONCURRENCY;
    delete process.env.MINI_AGENT_SUBAGENTS_MAX_STEPS;
    delete process.env.MINI_AGENT_SUBAGENTS_ALLOW_NESTED;
    delete process.env.MINI_AGENT_PERMISSION_MODE;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
    await fs.rm(userConfigHome, { recursive: true, force: true });
  });

  const writeUserConfig = async (content: string): Promise<string> => {
    const dir = path.join(userConfigHome, 'mini-agent');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'mini-agent.config.yaml');
    await fs.writeFile(file, content, 'utf8');
    return file;
  };

  it('resolves the user config dir from XDG_CONFIG_HOME', () => {
    expect(resolveUserConfigDir()).toBe(path.join(userConfigHome, 'mini-agent'));
  });

  it('user config applies when the workspace has no config file', async () => {
    await writeUserConfig('logging:\n  level: verbose\npermission_mode: bypass\n');

    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('verbose');
    expect(config.permissionMode).toBe('bypass');
  });

  it('missing user config directory does not affect resolution', () => {
    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('normal');
    expect(config.permissionMode).toBe('normal');
  });

  it('workspace config overrides user config per key', async () => {
    await writeUserConfig('permission_mode: bypass\nskills:\n  enabled: false\n');
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permission_mode: normal\n',
      'utf8',
    );

    const config = resolveAgentConfig({}, tempDir);
    expect(config.permissionMode).toBe('normal');
    // user values not mentioned by the workspace file still apply
    expect(config.skills.enabled).toBe(false);
  });

  it('user config fills gaps left by the workspace config', async () => {
    await writeUserConfig('subagents:\n  enabled: true\n');
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'logging:\n  level: verbose\n',
      'utf8',
    );

    const config = resolveAgentConfig({}, tempDir);
    expect(config.subagents.enabled).toBe(true);
    expect(config.logging.level).toBe('verbose');
  });

  it('nested sections merge per key', async () => {
    await writeUserConfig('cost_tracking:\n  currency: EUR\n  enabled: false\n');
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'cost_tracking:\n  enabled: true\n',
      'utf8',
    );

    const config = resolveAgentConfig({}, tempDir);
    expect(config.costTracking.currency).toBe('EUR');
    expect(config.costTracking.enabled).toBe(true);
  });

  it('arrays and scalars replace rather than concatenate', async () => {
    await writeUserConfig('skills:\n  allow: [git, code-review]\n');
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'skills:\n  allow: [git]\n',
      'utf8',
    );

    expect(resolveAgentConfig({}, tempDir).skills.allow).toEqual(['git']);
  });

  it('--config replaces only the workspace layer, keeping user defaults beneath it', async () => {
    await writeUserConfig('permission_mode: bypass\nsubagents:\n  enabled: true\n');
    await fs.writeFile(
      path.join(tempDir, 'alternate.yaml'),
      'permission_mode: normal\n',
      'utf8',
    );

    const config = resolveAgentConfig({ configPath: 'alternate.yaml' }, tempDir);
    expect(config.permissionMode).toBe('normal');
    expect(config.subagents.enabled).toBe(true);
  });

  it('deepMergeFileConfigs merges records recursively and replaces everything else', () => {
    const merged = deepMergeFileConfigs(
      { logging: { level: 'verbose' }, skills: { allow: ['a', 'b'] }, max_steps: 10 } as any,
      { logging: { filePath: '/tmp/log' }, skills: { allow: ['c'] }, max_steps: 20 } as any,
    );
    expect(merged).toEqual({
      logging: { level: 'verbose', filePath: '/tmp/log' },
      skills: { allow: ['c'] },
      max_steps: 20,
    });
  });

  it('returns default settings when no config file, env, or CLI overrides are present', () => {
    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('normal');
    expect(config.costTracking.enabled).toBe(false);
    expect(config.skills.enabled).toBe(true);
    expect(config.systemPrompt.enabled).toBe(true);
  });

  it('config file overrides defaults', async () => {
    const yamlContent = `
logging:
  level: verbose
cost_tracking:
  enabled: true
skills:
  enabled: false
system_prompt:
  enabled: false
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('verbose');
    expect(config.costTracking.enabled).toBe(true);
    expect(config.skills.enabled).toBe(false);
    expect(config.systemPrompt.enabled).toBe(false);
  });

  it('environment variables override config file', async () => {
    const yamlContent = `
logging:
  level: normal
cost_tracking:
  enabled: false
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    process.env.LOG_LEVEL = 'verbose';
    process.env.MINI_AGENT_COST_TRACKING = 'true';

    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('verbose');
    expect(config.costTracking.enabled).toBe(true);
  });

  it('CLI arguments override environment variables, config file, and defaults', async () => {
    const yamlContent = `
logging:
  level: normal
cost_tracking:
  enabled: false
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    process.env.LOG_LEVEL = 'normal';

    const config = resolveAgentConfig({
      logging: { level: 'verbose' },
      costTracking: { enabled: true },
    }, tempDir);

    expect(config.logging.level).toBe('verbose');
    expect(config.costTracking.enabled).toBe(true);
  });

  it('subagents defaults to disabled with bounded defaults', () => {
    const config = resolveAgentConfig({}, tempDir);
    expect(config.subagents).toEqual({
      enabled: false,
      maxConcurrency: 4,
      maxSteps: 30,
      allowNested: false,
    });
  });

  it('subagents config file overrides defaults including snake_case keys', async () => {
    const yamlContent = `
subagents:
  enabled: true
  max_concurrency: 2
  max_steps: 12
  allow_nested: true
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    const config = resolveAgentConfig({}, tempDir);
    expect(config.subagents).toEqual({
      enabled: true,
      maxConcurrency: 2,
      maxSteps: 12,
      allowNested: true,
    });
  });

  it('subagents environment variables override config file', async () => {
    const yamlContent = `
subagents:
  enabled: false
  max_concurrency: 2
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    process.env.MINI_AGENT_SUBAGENTS_ENABLED = 'true';
    process.env.MINI_AGENT_SUBAGENTS_MAX_CONCURRENCY = '7';

    const config = resolveAgentConfig({}, tempDir);
    expect(config.subagents.enabled).toBe(true);
    expect(config.subagents.maxConcurrency).toBe(7);
  });

  it('subagents CLI overrides beat environment and config file', async () => {
    const yamlContent = `
subagents:
  enabled: false
  max_steps: 5
`;
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yamlContent, 'utf8');

    process.env.MINI_AGENT_SUBAGENTS_ENABLED = 'true';
    process.env.MINI_AGENT_SUBAGENTS_MAX_STEPS = '9';

    const config = resolveAgentConfig({
      subagents: { enabled: false, maxSteps: 3 },
    }, tempDir);

    expect(config.subagents.enabled).toBe(false);
    expect(config.subagents.maxSteps).toBe(3);
  });

  it('subagents rejects invalid values', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'subagents:\n  enabled: true\n  max_concurrency: 0\n',
      'utf8',
    );
    expect(() => resolveAgentConfig({}, tempDir)).toThrow(/subagents\.maxConcurrency/);

    await fs.rm(path.join(tempDir, 'mini-agent.config.yaml'));

    expect(() =>
      resolveAgentConfig({ subagents: { maxSteps: -1 } }, tempDir),
    ).toThrow(/subagents\.maxSteps/);

    expect(() =>
      resolveAgentConfig({ subagents: { allowNested: 'yes' as any } }, tempDir),
    ).toThrow(/subagents\.allowNested/);
  });

  it('permissionMode defaults to normal', () => {
    const config = resolveAgentConfig({}, tempDir);
    expect(config.permissionMode).toBe('normal');
  });

  it('permissionMode config file overrides defaults including snake_case keys', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permission_mode: bypass\n',
      'utf8',
    );
    expect(resolveAgentConfig({}, tempDir).permissionMode).toBe('bypass');

    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permissionMode: yolo\n',
      'utf8',
    );
    expect(resolveAgentConfig({}, tempDir).permissionMode).toBe('bypass');
  });

  it('permissionMode environment variable overrides config file', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permission_mode: normal\n',
      'utf8',
    );
    process.env.MINI_AGENT_PERMISSION_MODE = 'dangerous';
    expect(resolveAgentConfig({}, tempDir).permissionMode).toBe('bypass');
  });

  it('permissionMode CLI overrides beat environment and config file', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permission_mode: bypass\n',
      'utf8',
    );
    process.env.MINI_AGENT_PERMISSION_MODE = 'bypass';
    expect(resolveAgentConfig({ permissionMode: 'normal' }, tempDir).permissionMode).toBe('normal');
  });

  it('permissionMode rejects invalid values', async () => {
    await fs.writeFile(
      path.join(tempDir, 'mini-agent.config.yaml'),
      'permission_mode: sometimes\n',
      'utf8',
    );
    expect(() => resolveAgentConfig({}, tempDir)).toThrow(/permission_mode/);

    await fs.rm(path.join(tempDir, 'mini-agent.config.yaml'));
    process.env.MINI_AGENT_PERMISSION_MODE = 'yolo';
    expect(resolveAgentConfig({}, tempDir).permissionMode).toBe('bypass');
    process.env.MINI_AGENT_PERMISSION_MODE = 'bogus';
    expect(() => resolveAgentConfig({}, tempDir)).toThrow(/permission_mode/);
  });
});
