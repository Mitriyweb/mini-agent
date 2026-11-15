import fs from 'node:fs';

export interface BuiltinSkillSource {
  name: string;
  path: string;
  raw: string;
}

export const BUILTIN_SKILL_NAMES = ['semantic-review', 'claude-review', 'codex-review'] as const;

const skillFileUrl = (name: string) => new URL(`../../skills/${name}/SKILL.md`, import.meta.url);

/**
 * Load the raw SKILL.md contents for skills bundled with mini-agent.
 * Workspace and user skills take precedence; callers should only use these
 * as a fallback when no customization of the same name exists.
 */
export const loadBuiltinSkillSources = async (): Promise<BuiltinSkillSource[]> => {
  const sources: BuiltinSkillSource[] = [];

  if (process.versions.bun) {
    const { builtinSkillContents } = await import('./bun-builtin-skills.ts');
    for (const name of BUILTIN_SKILL_NAMES) {
      const raw = builtinSkillContents[name];
      if (raw) {
        sources.push({ name, path: skillFileUrl(name).pathname, raw });
      }
    }
    return sources;
  }

  for (const name of BUILTIN_SKILL_NAMES) {
    try {
      const filePath = skillFileUrl(name);
      const raw = fs.readFileSync(filePath, 'utf8');
      sources.push({ name, path: filePath.pathname, raw });
    } catch {
      // Built-in skill files are optional at runtime; skip missing ones.
    }
  }
  return sources;
};
