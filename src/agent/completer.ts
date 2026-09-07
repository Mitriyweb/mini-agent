import fs from 'node:fs';
import path from 'node:path';
import type { Skill, Workflow } from './customizations.js';

export interface CompleterOptions {
  workspaceRoot: string;
  workflows?: Workflow[];
  skills?: Skill[];
}

const BUILTIN_SLASH_COMMANDS = ['/help', '/workflows', '/skills', '/exit', '/quit'];
const BUILTIN_ACTION_KEYWORDS = ['exit', 'quit', 'help', 'check', 'build', 'test', 'run', 'refactor', 'fix'];

export const getPathCompletions = (workspaceRoot: string, token: string): string[] => {
  try {
    let searchDir = workspaceRoot;
    let baseName = token;
    let prefix = '';

    const lastSlashIndex = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));

    if (lastSlashIndex >= 0) {
      prefix = token.slice(0, lastSlashIndex + 1);
      baseName = token.slice(lastSlashIndex + 1);
      searchDir = path.resolve(workspaceRoot, prefix);
    }

    if (!fs.existsSync(searchDir)) return [];
    const stat = fs.statSync(searchDir);
    if (!stat.isDirectory()) return [];

    const entries = fs.readdirSync(searchDir, { withFileTypes: true });
    const completions: string[] = [];

    for (const entry of entries) {
      if (entry.name.startsWith('.') && !baseName.startsWith('.')) {
        continue;
      }
      if ((entry.name === 'node_modules' || entry.name === '.git') && !baseName.startsWith(entry.name)) {
        continue;
      }

      if (entry.name.toLowerCase().startsWith(baseName.toLowerCase())) {
        let completion = prefix + entry.name;
        if (entry.isDirectory()) {
          completion += '/';
        }
        completions.push(completion);
      }
    }

    return completions;
  } catch {
    return [];
  }
};

export const createCompleter = (options: CompleterOptions) => {
  const { workspaceRoot, workflows = [], skills = [] } = options;

  return (line: string): [string[], string] => {
    if (typeof line !== 'string') return [[], ''];

    // 1. Slash command autocompletion when line starts with '/'
    if (line.startsWith('/')) {
      const allSlashCommands = [
        ...BUILTIN_SLASH_COMMANDS,
        ...workflows.map((w) => (w.command.startsWith('/') ? w.command : `/${w.command}`)),
        ...skills.map((s) => `/${s.name}`),
      ];
      const uniqueSlashCommands = Array.from(new Set(allSlashCommands));
      const hits = uniqueSlashCommands.filter((cmd) => cmd.toLowerCase().startsWith(line.toLowerCase()));
      return [hits, line];
    }

    const tokens = line.split(/\s+/);
    const lastToken = tokens[tokens.length - 1] || '';

    // If typing slash command in argument or nested
    if (lastToken.startsWith('/')) {
      const allSlashCommands = [
        ...BUILTIN_SLASH_COMMANDS,
        ...workflows.map((w) => (w.command.startsWith('/') ? w.command : `/${w.command}`)),
        ...skills.map((s) => `/${s.name}`),
      ];
      const uniqueSlashCommands = Array.from(new Set(allSlashCommands));
      const hits = uniqueSlashCommands.filter((cmd) => cmd.toLowerCase().startsWith(lastToken.toLowerCase()));
      return [hits, lastToken];
    }

    const matchesPath =
      lastToken.includes('/') ||
      lastToken.includes('\\') ||
      lastToken.startsWith('.') ||
      tokens.length > 1;

    let pathHits: string[] = [];
    if (matchesPath || lastToken.length > 0 || line.length === 0) {
      pathHits = getPathCompletions(workspaceRoot, lastToken);
    }

    if (pathHits.length > 0 && matchesPath) {
      return [pathHits, lastToken];
    }

    const candidateKeywords = Array.from(
      new Set([
        ...BUILTIN_ACTION_KEYWORDS,
        ...BUILTIN_SLASH_COMMANDS,
        ...workflows.map((w) => w.command),
        ...skills.map((s) => s.name),
      ]),
    );

    const keywordHits = candidateKeywords.filter((k) => k.toLowerCase().startsWith(lastToken.toLowerCase()));

    const allHits = Array.from(new Set([...keywordHits, ...pathHits]));
    if (allHits.length > 0) {
      return [allHits, lastToken];
    }

    return [[], lastToken];
  };
};
