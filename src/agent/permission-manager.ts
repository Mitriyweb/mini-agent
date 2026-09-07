import {
  PermissionMatchKind,
  PermissionScope,
  type PermissionRule,
} from '../types/permissions.js';
import { evaluateRules, normalizeCommand, tokenizeCommand } from './permission-matcher.js';
import { PermissionStore } from './permission-store.js';

export interface PermissionManagerOptions {
  configPath?: string;
  store?: PermissionStore;
}

export class PermissionManager {
  private sessionRules: PermissionRule[] = [];
  readonly store: PermissionStore | null;

  constructor(options: PermissionManagerOptions = {}) {
    if (options.store) {
      this.store = options.store;
    } else if (options.configPath) {
      this.store = new PermissionStore(options.configPath);
    } else {
      this.store = null;
    }
  }

  getSessionRules(): PermissionRule[] {
    return [...this.sessionRules];
  }

  getPersistentRules(): PermissionRule[] {
    if (!this.store) return [];
    return this.store.load().rules;
  }

  getAllRules(): PermissionRule[] {
    return [...this.getPersistentRules(), ...this.sessionRules];
  }

  addSessionRule(rule: PermissionRule): void {
    this.sessionRules.push({
      ...rule,
      scope: PermissionScope.SESSION,
      createdAt: rule.createdAt ?? Date.now(),
    });
  }

  addPersistentRule(rule: PermissionRule): void {
    if (this.store) {
      this.store.addRule(rule);
    } else {
      // Fallback if no store attached
      this.addSessionRule({ ...rule, scope: PermissionScope.PERSISTENT });
    }
  }

  evaluate(command: string): 'allow' | 'deny' | 'undecided' {
    return evaluateRules(this.getAllRules(), command);
  }

  generatePatternCandidates(command: string): { label: string; pattern: string; match: PermissionMatchKind }[] {
    const norm = normalizeCommand(command);
    if (!norm) return [];

    const tokens = tokenizeCommand(norm);
    const candidates: { label: string; pattern: string; match: PermissionMatchKind }[] = [];

    // Option 1: Exact command
    candidates.push({
      label: `Exact command: "${norm}"`,
      pattern: norm,
      match: PermissionMatchKind.EXACT,
    });

    if (tokens.length > 2) {
      // Option 2: Verb glob e.g. "git commit *"
      const verbPattern = `${tokens[0]} ${tokens[1]} *`;
      candidates.push({
        label: `Verb pattern: "${verbPattern}"`,
        pattern: verbPattern,
        match: PermissionMatchKind.GLOB,
      });
    }

    if (tokens.length > 1) {
      // Option 3: Binary glob e.g. "git *"
      const binPattern = `${tokens[0]} *`;
      candidates.push({
        label: `Binary pattern: "${binPattern}" (allows all ${tokens[0]} subcommands)`,
        pattern: binPattern,
        match: PermissionMatchKind.GLOB,
      });
    }

    return candidates;
  }
}
