import { describe, expect, it } from 'bun:test';
import path from 'node:path';
import { createCompleter, getPathCompletions } from '../src/agent/completer.js';

describe('completer test suite', () => {
  const workspaceRoot = process.cwd();

  const mockWorkflows = [
    {
      name: 'commit',
      command: '/commit',
      description: 'Commit changes',
      path: '.agents/workflows/commit.md',
      content: 'Commit prompt',
      raw: 'raw',
    },
    {
      name: 'refactor',
      command: '/refactor',
      description: 'Refactor code',
      path: '.agents/workflows/refactor.md',
      content: 'Refactor prompt',
      raw: 'raw',
    },
  ];

  const mockSkills = [
    {
      name: 'codebase-onboarding',
      description: 'Map codebase',
      dir: '.agents/skills/codebase-onboarding',
      path: '.agents/skills/codebase-onboarding/SKILL.md',
      content: 'Skill content',
      raw: 'raw',
    },
  ];

  const completer = createCompleter({
    workspaceRoot,
    workflows: mockWorkflows,
    skills: mockSkills,
  });

  it('completes slash commands', () => {
    const [hits1] = completer('/h');
    expect(hits1).toContain('/help');

    const [hits2] = completer('/comm');
    expect(hits2).toContain('/commit');

    const [hits3] = completer('/codebase');
    expect(hits3).toContain('/codebase-onboarding');
  });

  it('completes subdirectories and file paths', () => {
    const [hits] = completer('read src/a');
    expect(hits).toContain('src/agent/');
  });

  it('completes directory listing when ending in slash', () => {
    const hits = getPathCompletions(workspaceRoot, 'src/');
    expect(hits).toContain('src/agent/');
    expect(hits).toContain('src/start.ts');
  });

  it('filters node_modules and dotfiles unless requested', () => {
    const defaultHits = getPathCompletions(workspaceRoot, '');
    expect(defaultHits.some((h) => h.includes('node_modules'))).toBe(false);

    const dotHits = getPathCompletions(workspaceRoot, '.');
    expect(dotHits.some((h) => h.startsWith('.'))).toBe(true);
  });

  it('completes action keywords on partial match', () => {
    const [hits] = completer('che');
    expect(hits).toContain('check');
  });

  it('handles invalid paths gracefully', () => {
    const hits = getPathCompletions(workspaceRoot, 'nonexistent_folder_xyz_123/');
    expect(hits).toEqual([]);
  });

  it('handles empty line input', () => {
    const [hits, matchToken] = completer('');
    expect(matchToken).toBe('');
    expect(hits.length).toBeGreaterThan(0);
  });
});
