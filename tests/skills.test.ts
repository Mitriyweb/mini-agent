import { describe, expect, it } from 'bun:test';
import { filterSkills } from '../src/agent/skills.js';
import type { Skill } from '../src/agent/customizations.js';
import { parseArgs } from '../src/start.js';
import { resolveAgentConfig } from '../src/agent/config.js';

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
});
