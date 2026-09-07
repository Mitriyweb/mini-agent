import { describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PassThrough, Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import {
  evaluateRules,
  hasUnsafeShellSyntax,
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
    expect(normalizeCommand('git commit -m "foo\\"bar"')).toBe('git commit -m "foo\\"bar"');
  });

  it('tokenizeCommand parses arguments preserving quotes and escapes', () => {
    const tokens = tokenizeCommand('git commit -a -m "fix bug"');
    expect(tokens).toEqual(['git', 'commit', '-a', '-m', 'fix bug']);

    const escapedTokens = tokenizeCommand('git commit -m "foo\\"bar"');
    expect(escapedTokens).toEqual(['git', 'commit', '-m', 'foo"bar']);
  });

  it('splitShellCommands splits operators outside quotes', () => {
    const subs = splitShellCommands('git status && git commit -m "fix && bug" || echo done');
    expect(subs).toEqual(['git status', 'git commit -m "fix && bug"', 'echo done']);
  });

  it('matchesExact matches only exact commands or executable basenames', () => {
    expect(matchesExact('git status', 'git status')).toBe(true);
    expect(matchesExact('git status', 'git   status')).toBe(true);
    expect(matchesExact('git status', '/usr/bin/git status')).toBe(true);
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

  it('detects unsafe shell constructs and blocks wildcards (fail-closed)', () => {
    expect(hasUnsafeShellSyntax('git commit -m "$(rm -rf /)"')).toBe(true);
    expect(hasUnsafeShellSyntax('git commit -m "`echo malicious`"')).toBe(true);
    expect(hasUnsafeShellSyntax('git status > /tmp/out')).toBe(true);
    expect(hasUnsafeShellSyntax('git status >> /tmp/out')).toBe(true);
    expect(hasUnsafeShellSyntax('git status < /tmp/in')).toBe(true);
    expect(hasUnsafeShellSyntax('git status 2>/tmp/err')).toBe(true);
    expect(hasUnsafeShellSyntax('git commit -m "line1\nline2"')).toBe(true);
    expect(hasUnsafeShellSyntax('git commit -m "foo\\"$(echo evil)"')).toBe(true);

    // Wildcard matching fails closed for commands with unsafe constructs
    const pattern = 'git *';
    expect(matchesGlob(pattern, 'git status > /tmp/out')).toBe(false);
    expect(matchesGlob(pattern, 'git commit -m "$(echo malicious)"')).toBe(false);
    expect(matchesGlob(pattern, 'git commit -m "`echo malicious`"')).toBe(false);
  });

  it('exact rules allow explicitly authorized command strings even with redirects', () => {
    const rules: PermissionRule[] = [
      { effect: 'allow', pattern: 'git status > /tmp/out', match: 'exact' },
      { effect: 'allow', pattern: 'git *', match: 'glob' },
    ];

    // Exact rule explicitly matches authorized string
    expect(evaluateRules(rules, 'git status > /tmp/out')).toBe('allow');

    // Wildcard rule fails closed for unauthorized string with redirect
    expect(evaluateRules(rules, 'git status > /tmp/other')).toBe('undecided');
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

  it('PermissionStore strictly rejects unsupported config version', () => {
    const versionPath = path.join(tmpDir, 'bad-version.json');
    fs.writeFileSync(versionPath, JSON.stringify({ version: 999, rules: [{ effect: 'allow', pattern: 'git *', match: 'glob' }] }));

    const store = new PermissionStore(versionPath);
    const config = store.load();
    expect(config.version).toBe(1);
    expect(config.rules).toEqual([]); // Unsupported version discarded
  });

  it('PermissionStore discards rules with invalid match or effect values', () => {
    const invalidRulePath = path.join(tmpDir, 'invalid-rule.json');
    fs.writeFileSync(invalidRulePath, JSON.stringify({
      version: 1,
      rules: [
        { effect: 'allow', pattern: 'git status', match: 'invalid-match' },
        { effect: 'invalid-effect', pattern: 'git push', match: 'exact' },
        { effect: 'allow', pattern: 'git commit *', match: 'glob' }
      ]
    }));

    const store = new PermissionStore(invalidRulePath);
    const config = store.load();
    expect(config.rules.length).toBe(1);
    expect(config.rules[0].pattern).toBe('git commit *');
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

  it('PermissionManager evaluates global and project rules together', () => {
    const globalPath = path.join(tmpDir, 'global.json');
    const projectPath = path.join(tmpDir, 'project.json');
    const globalStore = new PermissionStore(globalPath);
    const projectStore = new PermissionStore(projectPath);
    globalStore.addRule({ effect: 'allow', pattern: 'git status', match: 'exact' });
    projectStore.addRule({ effect: 'deny', pattern: 'git push *', match: 'glob' });

    const manager = new PermissionManager({ store: projectStore, globalStore });
    expect(manager.evaluate('git status')).toBe('allow');
    expect(manager.evaluate('git push origin main')).toBe('deny');
  });
});

describe('Permissions System - Integration & Prompt Flow', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-flow-test-'));

  const mockTool = {
    needsApproval: true,
    definition: {
      type: 'function' as const,
      function: { name: 'bash', description: 'Run bash', parameters: {} },
    },
  };

  it('interactive prompt simulated readline flow: Allow session with pattern choice', async () => {
    const configPath = path.join(tmpDir, 'rl-session.json');
    const inputStream = new PassThrough();
    const outputStream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const rl = createInterface({ input: inputStream, output: outputStream });

    const permissions = createPermissions({ configPath, rl });

    const approvePromise = permissions.approve(mockTool, { command: 'git commit -a -m "fix"' });

    setImmediate(() => {
      inputStream.write('2\n'); // Option 2: Allow for session
      setImmediate(() => {
        inputStream.write('2\n'); // Pattern choice 2: git commit *
      });
    });

    const approved1 = await approvePromise;
    expect(approved1).toBe(true);

    // Second call in same session should auto-approve git commit -m "other"
    const approved2 = await permissions.approve(mockTool, { command: 'git commit -m "other"' });
    expect(approved2).toBe(true);

    rl.close();
  });

  it('interactive prompt can persist a rule globally', async () => {
    const configPath = path.join(tmpDir, 'project-global-choice.json');
    const globalConfigPath = path.join(tmpDir, 'global-choice.json');
    const inputStream = new PassThrough();
    const outputStream = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const rl = createInterface({ input: inputStream, output: outputStream });
    const permissions = createPermissions({ configPath, globalConfigPath, rl });

    const approvePromise = permissions.approve(mockTool, { command: 'git commit -a -m "global"' });
    setImmediate(() => {
      inputStream.write('4\n');
      setImmediate(() => inputStream.write('2\n'));
    });

    expect(await approvePromise).toBe(true);
    const globalRules = new PermissionStore(globalConfigPath).load().rules;
    expect(globalRules.some((rule) => rule.pattern === 'git commit *')).toBe(true);
    expect(new PermissionStore(configPath).load().rules).toEqual([]);
    rl.close();
  });

  it('askDecision callback enables structured permission decision handling', async () => {
    const configPath = path.join(tmpDir, 'ask-decision.json');
    const manager = new PermissionManager({ configPath });

    const permissions = createPermissions({
      manager,
      askDecision: ({ command, candidates }) => {
        expect(command).toBe('git commit -a -m "feature"');
        const verbCand = candidates.find((c) => c.pattern === 'git commit *');
        return {
          kind: 'allow-persistent',
          pattern: verbCand?.pattern,
          match: verbCand?.match,
        };
      },
    });

    const app1 = await permissions.approve(mockTool, { command: 'git commit -a -m "feature"' });
    expect(app1).toBe(true);

    // Check that persistent rule was written to store
    const storeRules = manager.getPersistentRules();
    expect(storeRules.some((r) => r.pattern === 'git commit *')).toBe(true);

    // Verify fresh session auto-approves via persisted rule
    const newManager = new PermissionManager({ configPath });
    let prompted = false;
    const permissions2 = createPermissions({
      manager: newManager,
      askDecision: () => {
        prompted = true;
        return false;
      },
    });

    const app2 = await permissions2.approve(mockTool, { command: 'git commit -m "another"' });
    expect(app2).toBe(true);
    expect(prompted).toBe(false);
  });
});
