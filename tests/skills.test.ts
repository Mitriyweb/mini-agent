import { describe, expect, it } from 'bun:test';
import { filterSkills } from '../src/agent/skills.js';
import { resolveSlashCommand, type Skill } from '../src/agent/customizations.js';
import { parseArgs } from '../src/start.js';
import { resolveAgentConfig } from '../src/agent/config.js';
import { isolateUserConfig } from './user-config-isolation.ts';

isolateUserConfig();

describe('Skills Management Test Suite', () => {
  const dummySkills: Skill[] = [
    { name: 'git', description: 'Git skill', dir: '/skills/git', path: '/skills/git/SKILL.md', content: 'git content', raw: 'git raw' },
    { name: 'code-review', description: 'Review skill', dir: '/skills/review', path: '/skills/review/SKILL.md', content: 'review content', raw: 'review raw' },
    { name: 'dangerous-skill', description: 'Dangerous skill', dir: '/skills/danger', path: '/skills/danger/SKILL.md', content: 'danger content', raw: 'danger raw' },
  ];

  it('Mode A: returns all skills when skills.enabled is true and allow/deny are empty', () => {
    const active = filterSkills(dummySkills, { enabled: true, allow: [], deny: [] });
    expect(active.length).toBe(3);
  });

  it('Mode B: returns empty array when skills.enabled is false', () => {
    const active = filterSkills(dummySkills, { enabled: false });
    expect(active.length).toBe(0);
  });

  it('Mode C: filters skills according to allow list', () => {
    const active = filterSkills(dummySkills, { enabled: true, allow: ['git', 'code-review'] });
    expect(active.map((s) => s.name)).toEqual(['git', 'code-review']);
  });

  it('Mode D: filters out skills listed in deny list', () => {
    const active = filterSkills(dummySkills, { enabled: true, deny: ['dangerous-skill'] });
    expect(active.map((s) => s.name)).toEqual(['git', 'code-review']);
  });

  it('Precedence: deny rule overrides allow rule when both contain the same skill', () => {
    const active = filterSkills(dummySkills, {
      enabled: true,
      allow: ['git', 'code-review', 'dangerous-skill'],
      deny: ['dangerous-skill'],
    });

    expect(active.map((s) => s.name)).toEqual(['git', 'code-review']);
    expect(active.some((s) => s.name === 'dangerous-skill')).toBe(false);
  });

  it('CLI --no-skills flag disables skills', () => {
    const cliOptions = parseArgs(['node', 'start.js', '--no-skills']);
    const config = resolveAgentConfig({
      skills: cliOptions.skillsEnabled !== undefined ? { enabled: cliOptions.skillsEnabled } : undefined,
    });

    expect(config.skills.enabled).toBe(false);
  });

  it('CLI --skills flag sets allow-list', () => {
    const cliOptions = parseArgs(['node', 'start.js', '--skills', 'git,code-review']);
    const config = resolveAgentConfig({
      skills: { enabled: cliOptions.skillsEnabled, allow: cliOptions.skillsAllow },
    });

    expect(config.skills.enabled).toBe(true);
    expect(config.skills.allow).toEqual(['git', 'code-review']);
  });

  it('resolves skills as slash commands', () => {
    const result = resolveSlashCommand('/git', [], dummySkills);

    expect(result?.matched).toBe(true);
    expect(result?.prompt).toContain('git content');
    expect(result?.skill?.name).toBe('git');
  });
});

describe('Built-in skills', () => {
  it('loadSkills includes built-in review skills as fallback', async () => {
    const { loadSkills } = await import('../src/agent/customizations.js');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-skills-'));

    const skills = await loadSkills(dir);
    const names = skills.map((s) => s.name);
    expect(names).toContain('semantic-review');
    expect(names).toContain('claude-review');
    expect(names).toContain('codex-review');
    const semantic = skills.find((s) => s.name === 'semantic-review');
    expect(semantic?.builtin).toBe(true);
    expect(semantic?.content.length).toBeGreaterThan(0);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('workspace skills take precedence over built-in skills of the same name', async () => {
    const { loadSkills } = await import('../src/agent/customizations.js');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-skills-'));
    const skillDir = path.join(dir, '.agents', 'skills', 'semantic-review');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: semantic-review\ndescription: Custom workspace review\n---\nCustom workspace review instructions.',
      'utf8',
    );

    const skills = await loadSkills(dir);
    const semantic = skills.find((s) => s.name === 'semantic-review');
    expect(semantic?.builtin).toBeUndefined();
    expect(semantic?.content).toContain('Custom workspace review instructions');
    // Other built-ins still fall back.
    expect(skills.some((s) => s.name === 'claude-review' && s.builtin)).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it('built-in skills resolve as slash commands', async () => {
    const { loadSkills, resolveSlashCommand } = await import('../src/agent/customizations.js');
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-skills-'));

    const skills = await loadSkills(dir);
    const resolved = resolveSlashCommand('/semantic-review focus on auth', [], skills);
    expect(resolved?.matched).toBe(true);
    expect(resolved?.kind).toBe('skill');
    expect(resolved?.prompt).toContain('Semantic Review');
    expect(resolved?.prompt).toContain('focus on auth');

    await fs.rm(dir, { recursive: true, force: true });
  });
});
