import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  evaluateRules,
  matchesExact,
  matchesGlob,
  normalizeCommand,
  splitShellCommands,
  tokenizeCommand,
} from '../src/agent/permission-matcher.js';
import { PermissionStore } from '../src/agent/permission-store.ts';
import { PermissionManager } from '../src/agent/permission-manager.ts';
import { createPermissions } from '../src/agent/permissions.ts';
import type { PermissionRule } from '../src/types/permissions.ts';

describe('Permissions System - Matcher Unit Tests', () => {
  it('normalizeCommand handles spaces and quotes correctly', () => {
    expect(normalizeCommand('  git   commit   -m   "fix   bug"  ')).toBe('git commit -m "fix   bug"');
    expect(normalizeCommand('git   status')).toBe('git status');
  });

  it('tokenizeCommand parses arguments preserving quotes', () => {
    const tokens = tokenizeCommand('git commit -a -m "fix bug"');
    expect(tokens).toEqual(['git', 'commit', '-a', '-m', 'fix bug']);
  });

  it('splitShellCommands splits operators outside quotes', () => {
    const subs = splitShellCommands('git status && git commit -m "fix && bug" || echo done');
    expect(subs).toEqual(['git status', 'git commit -m "fix && bug"', 'echo done']);
  });

  it('matchesExact matches only exact commands', () => {
    expect(matchesExact('git status', 'git status')).toBe(true);
    expect(matchesExact('git status', 'git   status')).toBe(true);
    expect(matchesExact('git status', 'git status --short')).toBe(false);
    expect(matchesExact('git status', 'git status-other')).toBe(false);
  });

  it('matchesGlob matches verb wildcard (git commit *)', () => {
    const pattern = 'git commit *';
    expect(matchesGlob(pattern, 'git commit -m "test"')).toBe(true);
    expect(matchesGlob(pattern, 'git commit -a -m "test"')).toBe(true);
    expect(matchesGlob(pattern, 'git commit --amend')).toBe(true);
    expect(matchesGlob(pattern, 'git commit')).toBe(true);

    expect(matchesGlob(pattern, 'git push')).toBe(false);
    expect(matchesGlob(pattern, 'git commit-other')).toBe(false);
  });

  it('matchesGlob matches broad wildcard (git *) with strict boundaries', () => {
    const pattern = 'git *';
    expect(matchesGlob(pattern, 'git status')).toBe(true);
    expect(matchesGlob(pattern, 'git add .')).toBe(true);
    expect(matchesGlob(pattern, 'git commit -m "test"')).toBe(true);
    expect(matchesGlob(pattern, 'git checkout main')).toBe(true);
    expect(matchesGlob(pattern, 'git')).toBe(true);

    expect(matchesGlob(pattern, 'gitfoo')).toBe(false);
    expect(matchesGlob(pattern, 'git-other')).toBe(false);
  });

  it('evaluates rule priority: deny > allow exact > allow mask', () => {
    const rules: PermissionRule[] = [
      { effect: 'allow', pattern: 'git *', match: 'glob' },
      { effect: 'deny', pattern: 'git push *', match: 'glob' },
    ];

    expect(evaluateRules(rules, 'git status')).toBe('allow');
    expect(evaluateRules(rules, 'git push origin main')).toBe('deny');
    expect(evaluateRules(rules, 'git status && git push origin main')).toBe('deny');
  });

  it('compound shell command security evaluation (fail-closed)', () => {
    const rules: PermissionRule[] = [
      { effect: 'allow', pattern: 'git commit *', match: 'glob' },
    ];

    // Allowed subcommand + forbidden subcommand = undecided/prompt
    expect(evaluateRules(rules, 'git commit -m "fix" && rm -rf /')).toBe('undecided');

    const rulesBoth: PermissionRule[] = [
      { effect: 'allow', pattern: 'git status', match: 'exact' },
      { effect: 'allow', pattern: 'git commit *', match: 'glob' },
    ];
    expect(evaluateRules(rulesBoth, 'git status && git commit -m "fix"')).toBe('allow');
  });
});

describe('Permissions System - Store & Manager Tests', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-perm-test-'));
  const configPath = path.join(tmpDir, 'permissions.json');

  it('PermissionStore handles missing config gracefully', () => {
    const store = new PermissionStore(path.join(tmpDir, 'nonexistent.json'));
    const config = store.load();
    expect(config.version).toBe(1);
    expect(config.rules).toEqual([]);
  });

  it('PermissionStore handles corrupted config gracefully', () => {
    const corruptPath = path.join(tmpDir, 'corrupt.json');
    fs.writeFileSync(corruptPath, '{ bad json syntax');

    const store = new PermissionStore(corruptPath);
    const config = store.load();
    expect(config.version).toBe(1);
    expect(config.rules).toEqual([]);
  });

  it('PermissionStore performs atomic write and respects version field', () => {
    const store = new PermissionStore(configPath);
    store.addRule({ effect: 'allow', pattern: 'git status', match: 'exact' });

    expect(fs.existsSync(configPath)).toBe(true);
    const loaded = store.load();
    expect(loaded.version).toBe(1);
    expect(loaded.rules.length).toBe(1);
    expect(loaded.rules[0].pattern).toBe('git status');
  });

  it('PermissionStore does not store session rules on disk', () => {
    const manager = new PermissionManager({ configPath });
    manager.addSessionRule({ effect: 'allow', pattern: 'session-cmd', match: 'exact' });
    manager.addPersistentRule({ effect: 'allow', pattern: 'always-cmd', match: 'exact' });

    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const storedPatterns = rawConfig.rules.map((r: any) => r.pattern);
    expect(storedPatterns).toContain('always-cmd');
    expect(storedPatterns).not.toContain('session-cmd');
  });
});

describe('Permissions System - Integration & Lifetime Scopes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-scope-test-'));
  const configPath = path.join(tmpDir, 'permissions.json');

  const mockTool = {
    needsApproval: true,
    definition: {
      type: 'function' as const,
      function: { name: 'bash', description: 'Run bash', parameters: {} },
    },
  };

  it('Allow once scope asks again on second invocation', async () => {
    let promptCount = 0;
    const permissions = createPermissions({
      configPath,
      ask: () => {
        promptCount++;
        return true;
      },
    });

    const approved1 = await permissions.approve(mockTool, { command: 'git status' });
    expect(approved1).toBe(true);
    expect(promptCount).toBe(1);

    const approved2 = await permissions.approve(mockTool, { command: 'git status' });
    expect(approved2).toBe(true);
    expect(promptCount).toBe(2);
  });

  it('Allow for session scope bypasses prompt in same session, prompts in new session', async () => {
    let promptCount = 0;
    const manager = new PermissionManager({ configPath });

    const permissionsSession1 = createPermissions({
      manager,
      ask: () => {
        promptCount++;
        return true;
      },
    });

    // Manually simulate user selecting session approval
    manager.addSessionRule({ effect: 'allow', pattern: 'git status', match: 'exact' });

    const app1 = await permissionsSession1.approve(mockTool, { command: 'git status' });
    expect(app1).toBe(true);
    expect(promptCount).toBe(0); // Bypassed prompt due to session rule!

    // New session (new PermissionManager without session rules)
    const newManager = new PermissionManager({ configPath });
    const permissionsSession2 = createPermissions({
      manager: newManager,
      ask: () => {
        promptCount++;
        return true;
      },
    });

    await permissionsSession2.approve(mockTool, { command: 'git status' });
    expect(promptCount).toBe(1); // Prompted in new session!
  });

  it('Allow always scope persists across restarts', async () => {
    const manager1 = new PermissionManager({ configPath });
    manager1.addPersistentRule({ effect: 'allow', pattern: 'git commit *', match: 'glob' });

    // Restart agent with new manager loading same configPath
    const manager2 = new PermissionManager({ configPath });
    let prompted = false;
    const permissions = createPermissions({
      manager: manager2,
      ask: () => {
        prompted = true;
        return true;
      },
    });

    const approved = await permissions.approve(mockTool, { command: 'git commit -a -m "test"' });
    expect(approved).toBe(true);
    expect(prompted).toBe(false); // Persistent rule auto-approved!
  });

  it('--yes / autoApprove skips prompts without writing persistent rules', async () => {
    const freshConfigPath = path.join(tmpDir, 'auto-approve-perm.json');
    const permissions = createPermissions({
      configPath: freshConfigPath,
      autoApprove: true,
    });

    const approved = await permissions.approve(mockTool, { command: 'git push --force' });
    expect(approved).toBe(true);

    // Verify config file was NOT created / modified with persistent rules
    if (fs.existsSync(freshConfigPath)) {
      const content = JSON.parse(fs.readFileSync(freshConfigPath, 'utf8'));
      expect(content.rules).toEqual([]);
    }
  });
});
