import type { PartialAgentConfig } from './config.ts';

/**
 * A named agent profile that supplies additive configuration presets.
 * Profiles are applied after file config and before CLI overrides in the
 * precedence chain: defaults < file < profile < env < CLI.
 */
export interface AgentProfile {
  /** Unique identifier used with --profile <name>. */
  name: string;
  /** Short human-readable description shown in help output. */
  description: string;
  /**
   * Configuration overrides supplied by this profile.
   * These are additive presets — they do NOT override explicit CLI flags.
   * Profiles may NOT modify permission, workspace, or autoApprove settings.
   */
  config: Omit<PartialAgentConfig, 'autoApprove' | 'configPath'>;
}

/**
 * Built-in profiles.
 *
 * The "default" profile is a no-op used internally to confirm no profile is
 * selected; it is never applied as an override.
 */
export const BUILT_IN_PROFILES: AgentProfile[] = [
  {
    name: 'default',
    description: 'Standard behavior — same as running without --profile.',
    config: {},
  },
  {
    name: 'planner',
    description: 'Optimized for planning and design tasks — verbose logging, more steps.',
    config: {
      logging: { level: 'verbose' },
      maxSteps: 50,
      systemPrompt: { enabled: true },
    },
  },
  {
    name: 'developer',
    description: 'Optimized for implementation tasks — balanced steps and normal logging.',
    config: {
      logging: { level: 'normal' },
      maxSteps: 40,
      systemPrompt: { enabled: true },
    },
  },
  {
    name: 'reviewer',
    description: 'Optimized for code review — skills enabled, read-focused.',
    config: {
      logging: { level: 'normal' },
      maxSteps: 30,
      skills: { enabled: true },
      systemPrompt: { enabled: true },
    },
  },
  {
    name: 'qa',
    description: 'Optimized for QA and testing tasks — verbose logging, extended steps.',
    config: {
      logging: { level: 'verbose' },
      maxSteps: 50,
      skills: { enabled: true },
      systemPrompt: { enabled: true },
    },
  },
];

/** Retrieve a built-in profile by name (case-insensitive). */
export const getBuiltInProfile = (name: string): AgentProfile | undefined =>
  BUILT_IN_PROFILES.find((p) => p.name.toLowerCase() === name.toLowerCase());

/** All valid built-in profile names. */
export const VALID_PROFILE_NAMES: string[] = BUILT_IN_PROFILES.map((p) => p.name);

/**
 * Validate a profile name.
 * Returns `{ valid: true }` when the name is recognised,
 * or `{ valid: false, error: string }` otherwise.
 */
export const validateProfileName = (
  name: string,
): { valid: true } | { valid: false; error: string } => {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Profile name must be a non-empty string.' };
  }
  const normalised = name.trim().toLowerCase();
  if (!normalised) {
    return { valid: false, error: 'Profile name must be a non-empty string.' };
  }
  const found = BUILT_IN_PROFILES.some((p) => p.name.toLowerCase() === normalised);
  if (!found) {
    return {
      valid: false,
      error: `Unknown profile "${name}". Valid profiles: ${VALID_PROFILE_NAMES.join(', ')}.`,
    };
  }
  return { valid: true };
};

/**
 * Resolve a profile by name and return its safe config overrides.
 *
 * The "default" profile returns an empty object so no overrides are applied.
 * Unknown names throw an error (callers should call `validateProfileName`
 * first for friendlier UX).
 */
export const resolveProfile = (name: string): Omit<PartialAgentConfig, 'autoApprove' | 'configPath'> => {
  const validation = validateProfileName(name);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  const profile = getBuiltInProfile(name)!;
  if (profile.name === 'default') {
    return {};
  }
  return profile.config;
};
