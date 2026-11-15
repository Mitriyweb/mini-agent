import semanticReview from '../../skills/semantic-review/SKILL.md' with { type: 'text' };
import claudeReview from '../../skills/claude-review/SKILL.md' with { type: 'text' };
import codexReview from '../../skills/codex-review/SKILL.md' with { type: 'text' };

export const builtinSkillContents: Record<string, string> = {
  'semantic-review': semanticReview,
  'claude-review': claudeReview,
  'codex-review': codexReview,
};
