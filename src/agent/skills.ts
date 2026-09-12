import type { Skill } from './customizations.ts';

export interface SkillsConfig {
  enabled: boolean;
  allow?: string[];
  deny?: string[];
}

export const filterSkills = (skills: Skill[], config: SkillsConfig): Skill[] => {
  if (!config.enabled) {
    return [];
  }

  const allowList = config.allow?.map((s) => s.toLowerCase().trim()).filter(Boolean) ?? [];
  const denyList = config.deny?.map((s) => s.toLowerCase().trim()).filter(Boolean) ?? [];

  return skills.filter((skill) => {
    const skillName = skill.name.toLowerCase().trim();

    // Deny has precedence over Allow
    if (denyList.includes(skillName)) {
      return false;
    }

    if (allowList.length > 0) {
      return allowList.includes(skillName);
    }

    return true;
  });
};
