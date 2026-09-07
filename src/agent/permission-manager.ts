import {
  PermissionMatchKind,
  PermissionScope,
  type PermissionRule,
} from '../types/permissions.js';
import { evaluateRules, normalizeCommand, tokenizeCommand } from './permission-matcher.js';
import { PermissionStore } from './permission-store.js';

export interface PermissionManagerOptions {
  configPath?: string;
  globalConfigPath?: string;
  store?: PermissionStore;
  globalStore?: PermissionStore;
}

export class PermissionManager {
  private sessionRules: PermissionRule[] = [];
  readonly store: PermissionStore | null;
  readonly globalStore: PermissionStore | null;

  constructor(options: PermissionManagerOptions = {}) {
    this.store = options.store ?? (options.configPath ? new PermissionStore(options.configPath) : null);
    this.globalStore = options.globalStore ?? (options.globalConfigPath ? new PermissionStore(options.globalConfigPath) : null);
  }

  getSessionRules(): PermissionRule[] {
    return [...this.sessionRules];
  }

  getPersistentRules(): PermissionRule[] {
    if (!this.store) return [];
    return this.store.load().rules;
  }

  getGlobalRules(): PermissionRule[] {
    if (!this.globalStore) return [];
    return this.globalStore.load().rules;
  }

  getAllRules(): PermissionRule[] {
    return [...this.getGlobalRules(), ...this.getPersistentRules(), ...this.sessionRules];
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

  addGlobalRule(rule: PermissionRule): void {
    if (this.globalStore) {
      this.globalStore.addRule(rule);
    } else {
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
