import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { resolveAgentConfig } from '../src/agent/config.js';
import {
  validateProfileName,
  resolveProfile,
  VALID_PROFILE_NAMES,
  getBuiltInProfile,
} from '../src/agent/profiles.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Profile unit tests
// ---------------------------------------------------------------------------
describe('validateProfileName', () => {
  it('accepts all valid built-in profile names', () => {
    for (const name of VALID_PROFILE_NAMES) {
      const result = validateProfileName(name);
      expect(result.valid).toBe(true);
    }
  });

  it('accepts names case-insensitively', () => {
    expect(validateProfileName('DEVELOPER').valid).toBe(true);
    expect(validateProfileName('Planner').valid).toBe(true);
  });

  it('rejects an unknown profile name', () => {
    const result = validateProfileName('nonexistent');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('Unknown profile');
      expect(result.error).toContain('nonexistent');
    }
  });

  it('rejects an empty string', () => {
    const result = validateProfileName('');
    expect(result.valid).toBe(false);
  });
});

describe('resolveProfile', () => {
  it('returns empty config for the default profile', () => {
    const overrides = resolveProfile('default');
    expect(Object.keys(overrides).length).toBe(0);
  });

  it('returns non-empty config for the developer profile', () => {
    const overrides = resolveProfile('developer');
    expect(overrides.maxSteps).toBeDefined();
  });

  it('throws for unknown profile names', () => {
    expect(() => resolveProfile('badprofile')).toThrow(/Unknown profile/);
  });

  it('does not include autoApprove in any profile config', () => {
    for (const name of VALID_PROFILE_NAMES) {
      const overrides = resolveProfile(name) as Record<string, unknown>;
      expect(overrides).not.toHaveProperty('autoApprove');
    }
  });

  it('does not include configPath in any profile config', () => {
    for (const name of VALID_PROFILE_NAMES) {
      const overrides = resolveProfile(name) as Record<string, unknown>;
      expect(overrides).not.toHaveProperty('configPath');
    }
  });
});

describe('getBuiltInProfile', () => {
  it('returns the profile for a valid name', () => {
    const p = getBuiltInProfile('planner');
    expect(p).toBeDefined();
    expect(p?.name).toBe('planner');
  });

  it('returns undefined for an unknown name', () => {
    expect(getBuiltInProfile('unknown')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Profile integration with resolveAgentConfig
// ---------------------------------------------------------------------------
describe('Profile precedence in resolveAgentConfig', () => {
  let tempDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-profiles-test-'));
    originalEnv = {
      LOG_LEVEL: process.env.LOG_LEVEL,
      MINI_AGENT_LOG_LEVEL: process.env.MINI_AGENT_LOG_LEVEL,
      MINI_AGENT_SKILLS_ENABLED: process.env.MINI_AGENT_SKILLS_ENABLED,
      MINI_AGENT_SYSTEM_PROMPT_ENABLED: process.env.MINI_AGENT_SYSTEM_PROMPT_ENABLED,
    };
    delete process.env.LOG_LEVEL;
    delete process.env.MINI_AGENT_LOG_LEVEL;
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

  it('default behavior is unchanged when no profile is specified', () => {
    const config = resolveAgentConfig({}, tempDir);
    expect(config.logging.level).toBe('normal');
    expect(config.skills.enabled).toBe(true);
    expect(config.systemPrompt.enabled).toBe(true);
  });

  it('planner profile applies verbose logging and extended maxSteps', () => {
    const config = resolveAgentConfig({ profile: 'planner' }, tempDir);
    expect(config.logging.level).toBe('verbose');
    expect(config.maxSteps).toBe(50);
  });

  it('developer profile applies normal logging and extended maxSteps', () => {
    const config = resolveAgentConfig({ profile: 'developer' }, tempDir);
    expect(config.logging.level).toBe('normal');
    expect(config.maxSteps).toBe(40);
  });

  it('reviewer profile enables skills', () => {
    const config = resolveAgentConfig({ profile: 'reviewer' }, tempDir);
    expect(config.skills.enabled).toBe(true);
  });

  it('qa profile applies verbose logging and extended maxSteps', () => {
    const config = resolveAgentConfig({ profile: 'qa' }, tempDir);
    expect(config.logging.level).toBe('verbose');
    expect(config.maxSteps).toBe(50);
    expect(config.skills.enabled).toBe(true);
  });

  it('explicit CLI logging overrides the profile', () => {
    // planner wants verbose, CLI explicitly requests normal — CLI wins
    const config = resolveAgentConfig(
      { profile: 'planner', logging: { level: 'normal' } },
      tempDir,
    );
    expect(config.logging.level).toBe('normal');
  });

  it('explicit CLI maxSteps overrides the profile', () => {
    // planner wants 50, CLI wants 10 — CLI wins
    const config = resolveAgentConfig({ profile: 'planner', maxSteps: 10 }, tempDir);
    expect(config.maxSteps).toBe(10);
  });

  it('profile wins over file config values', async () => {
    // File says level: normal, planner profile sets verbose — profile wins
    const yaml = 'logging:\n  level: normal\n';
    await fs.writeFile(path.join(tempDir, 'mini-agent.config.yaml'), yaml, 'utf8');
    const config = resolveAgentConfig({ profile: 'planner' }, tempDir);
    expect(config.logging.level).toBe('verbose');
  });

  it('env variable overrides profile value', () => {
    // planner sets verbose, env overrides to off — env wins
    process.env.MINI_AGENT_LOG_LEVEL = 'off';
    const config = resolveAgentConfig({ profile: 'planner' }, tempDir);
    expect(config.logging.level).toBe('off');
  });

  it('profiles cannot set autoApprove — it remains subject to explicit config only', () => {
    // No profile should introduce autoApprove: true implicitly
    const configNoProfile = resolveAgentConfig({}, tempDir);
    const configWithProfile = resolveAgentConfig({ profile: 'planner' }, tempDir);
    // autoApprove default is undefined/false in both cases
    expect(configWithProfile.autoApprove).toBe(configNoProfile.autoApprove);
  });

  it('throws for an unknown profile name', () => {
    expect(() => resolveAgentConfig({ profile: 'badprofile' }, tempDir)).toThrow(/Unknown profile/);
  });
});
