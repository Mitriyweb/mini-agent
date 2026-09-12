import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { resolveAgentConfig } from '../src/agent/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('Configuration Precedence Test Suite (defaults < config file < env < CLI)', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-config-test-'));
    originalEnv = {
      LOG_LEVEL: process.env.LOG_LEVEL,
      MINI_AGENT_LOG_LEVEL: process.env.MINI_AGENT_LOG_LEVEL,
      MINI_AGENT_COST_TRACKING: process.env.MINI_AGENT_COST_TRACKING,
      MINI_AGENT_SKILLS_ENABLED: process.env.MINI_AGENT_SKILLS_ENABLED,
      MINI_AGENT_SYSTEM_PROMPT_ENABLED: process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED,
    };
    delete process.env.LOG_LEVEL;
    delete process.env.MINI_AGENT_LOG_LEVEL;
    delete process.env.MINI_AGENT_COST_TRACKING;
    delete process.env.MINI_AGENT_SKILLS_ENABLED;
    delete process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED;
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tempDir, { recursive: true, force: true });
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
});
