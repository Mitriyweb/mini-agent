import path from 'node:path';
import type { PermissionRule } from '../types/permissions.js';

/**
 * Normalizes command string by trimming and collapsing multiple spaces outside quotes.
 */
export const normalizeCommand = (command: string): string => {
  if (!command) return '';
  const trimmed = command.trim();
  let result = '';
  let inSingle = false;
  let inDouble = false;
  let lastWasSpace = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    if (char === '\\' && i + 1 < trimmed.length) {
      result += char + nextChar;
      i++;
      lastWasSpace = false;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      result += char;
      lastWasSpace = false;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      result += char;
      lastWasSpace = false;
    } else if (/\s/.test(char) && !inSingle && !inDouble) {
      if (!lastWasSpace) {
        result += ' ';
        lastWasSpace = true;
      }
    } else {
      result += char;
      lastWasSpace = false;
    }
  }

  return result.trim();
};

/**
 * Tokenizes a command into argument tokens, respecting quotes and escapes.
 */
export const tokenizeCommand = (command: string): string[] => {
  const normalized = normalizeCommand(command);
  if (!normalized) return [];

  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    const nextChar = normalized[i + 1];

    if (char === '\\' && i + 1 < normalized.length) {
      current += nextChar;
      i++;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (/\s/.test(char) && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
};

/**
 * Checks whether a command contains unsafe shell constructs that prevent safe
 * wildcard matching (e.g. command substitution, backticks, newlines, subshells, or redirects).
 */
export const hasUnsafeShellSyntax = (command: string): boolean => {
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (char === '\\') {
      if (i + 1 >= command.length) {
        return true; // Trailing backslash / line continuation
      }
      i++; // Skip escaped character
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === '\n' || char === '\r') {
      return true;
    } else if (char === '`') {
      return true;
    } else if (!inSingle) {
      if (char === '$' && nextChar === '(') {
        return true;
      }
      if (!inDouble) {
        if (char === '>' || char === '<' || char === '(' || char === ')') {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Splits a compound shell command by control operators (&&, ||, ;, |, &)
 * outside of quotes.
 */
export const splitShellCommands = (command: string): string[] => {
  const trimmed = command.trim();
  if (!trimmed) return [];

  const subcommands: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    const nextChar = trimmed[i + 1];

    if (char === '\\' && i + 1 < trimmed.length) {
      current += char + nextChar;
      i++;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      current += char;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      current += char;
    } else if (!inSingle && !inDouble) {
      if ((char === '&' && nextChar === '&') || (char === '|' && nextChar === '|')) {
        if (current.trim().length > 0) {
          subcommands.push(current.trim());
        }
        current = '';
        i++; // skip second char of operator
      } else if (char === ';' || char === '|' || char === '&') {
        if (current.trim().length > 0) {
          subcommands.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) {
    subcommands.push(current.trim());
  }

  return subcommands;
};

/**
 * Converts a simple wildcard string (with * and ?) into a RegExp.
 */
export const globToRegExp = (pattern: string): RegExp => {
  let regexStr = '^';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '*') {
      regexStr += '.*';
    } else if (char === '?') {
      regexStr += '.';
    } else if ('/\\^$+?.()|[]{}'.includes(char)) {
      regexStr += '\\' + char;
    } else {
      regexStr += char;
    }
  }
  regexStr += '$';
  return new RegExp(regexStr);
};

/**
 * Checks if a single subcommand matches an exact pattern.
 */
export const matchesExact = (pattern: string, subcommand: string): boolean => {
  const normPattern = normalizeCommand(pattern);
  const normSubcommand = normalizeCommand(subcommand);
  if (normPattern === normSubcommand) return true;

  // Also check if executable paths match by basename
  const patTokens = tokenizeCommand(normPattern);
  const subTokens = tokenizeCommand(normSubcommand);

  if (patTokens.length === subTokens.length && patTokens.length > 0) {
    const patExe = patTokens[0];
    const subExe = subTokens[0];
    const exeMatches = patExe === subExe || patExe === path.basename(subExe) || path.basename(patExe) === subExe;

    if (exeMatches) {
      const restPat = patTokens.slice(1).join(' ');
      const restSub = subTokens.slice(1).join(' ');
      return restPat === restSub;
    }
  }

  return false;
};

/**
 * Matches token sequences where '*' in patTokens matches 0 or more tokens.
 */
export const matchTokenSequence = (patTokens: string[], subTokens: string[]): boolean => {
  let p = 0;
  let s = 0;
  let starIdx = -1;
  let matchIdx = -1;

  while (s < subTokens.length) {
    if (p < patTokens.length) {
      const pToken = patTokens[p];
      const sToken = subTokens[s];

      if (pToken === '*') {
        starIdx = p;
        matchIdx = s;
        p++;
        continue;
      }

      const exeOk = p === 0 && (pToken === sToken || pToken === path.basename(sToken) || path.basename(pToken) === sToken);
      const tokenMatch = exeOk || pToken === sToken || globToRegExp(pToken).test(sToken);

      if (tokenMatch) {
        p++;
        s++;
        continue;
      }
    }

    if (starIdx !== -1) {
      p = starIdx + 1;
      matchIdx++;
      s = matchIdx;
      continue;
    }

    return false;
  }

  while (p < patTokens.length && patTokens[p] === '*') {
    p++;
  }

  return p === patTokens.length;
};

/**
 * Checks if a single subcommand matches a glob pattern.
 * Fail closed if the subcommand contains unsafe shell syntax (substitutions, redirects, etc.).
 */
export const matchesGlob = (pattern: string, subcommand: string): boolean => {
  if (hasUnsafeShellSyntax(subcommand)) {
    return false;
  }

  const normPattern = normalizeCommand(pattern);
  const normSubcommand = normalizeCommand(subcommand);

  if (matchesExact(pattern, subcommand)) return true;

  const patTokens = tokenizeCommand(normPattern);
  const subTokens = tokenizeCommand(normSubcommand);

  if (patTokens.length === 0 || subTokens.length === 0) return false;

  return matchTokenSequence(patTokens, subTokens);
};

/**
 * Evaluates a command against a list of rules adhering to priority:
 * deny > allow exact > allow mask
 */
export const evaluateRules = (rules: PermissionRule[], command: string): 'allow' | 'deny' | 'undecided' => {
  const normCommand = normalizeCommand(command);
  if (!normCommand) return 'undecided';

  const subcommands = splitShellCommands(normCommand);
  if (subcommands.length === 0) return 'undecided';

  const denyRules = rules.filter((r) => r.effect === 'deny');
  const allowExactRules = rules.filter((r) => r.effect === 'allow' && r.match === 'exact');
  const allowGlobRules = rules.filter((r) => r.effect === 'allow' && r.match === 'glob');

  // 1. Check deny rules
  for (const rule of denyRules) {
    const isMatch = (sub: string) =>
      rule.match === 'exact' ? matchesExact(rule.pattern, sub) : matchesGlob(rule.pattern, sub);

    if (isMatch(normCommand)) return 'deny';
    for (const sub of subcommands) {
      if (isMatch(sub)) return 'deny';
    }
  }

  // 2. Check full command exact match
  for (const rule of allowExactRules) {
    if (matchesExact(rule.pattern, normCommand)) return 'allow';
  }

  // 3. For subcommands, check each against allow rules
  for (const sub of subcommands) {
    let allowedForSub = false;

    for (const rule of allowExactRules) {
      if (matchesExact(rule.pattern, sub)) {
        allowedForSub = true;
        break;
      }
    }

    if (!allowedForSub) {
      for (const rule of allowGlobRules) {
        if (matchesGlob(rule.pattern, sub)) {
          allowedForSub = true;
          break;
        }
      }
    }

    if (!allowedForSub) {
      return 'undecided';
    }
  }

  return 'allow';
};
