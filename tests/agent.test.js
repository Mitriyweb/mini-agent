'use strict';

const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const { test, describe, before, after } = require('node:test');
const fs = require('node:fs/promises');

const { registry } = require('../agent/tools.js');
const { createProvider } = require('../agent/llm.js');
const { createPermissions } = require('../agent/permissions.js');
const {
  parseFrontmatter,
  loadWorkflows,
  loadSkills,
  formatCustomizationsPrompt,
  resolveWorkflowCommand,
} = require('../agent/customizations.js');
const { openWorkspace, workspace } = require('../agent/workspace.js');
const { parseArgs } = require('../start.js');

describe('mini-agent tests', () => {
  let tempDir;

  before(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-test-'));
    await fs.writeFile(path.join(tempDir, 'sample.txt'), 'Hello mini-agent!');
    await openWorkspace(tempDir);
  });

  after(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  test('tools.js registry loads expected tools', () => {
    assert.ok(registry instanceof Map, 'registry should be a Map');
    const expectedTools = ['read', 'write', 'edit', 'bash', 'glob', 'grep', 'delete', 'patch', 'check', 'fetch', 'todo'];
    for (const toolName of expectedTools) {
      assert.ok(registry.has(toolName), `Registry missing tool: ${toolName}`);
      const tool = registry.get(toolName);
      assert.strictEqual(typeof tool.execute, 'function', `${toolName} should have execute function`);
      assert.ok(tool.definition, `${toolName} should have tool definition`);
    }
  });

  test('workspace.js resolves paths inside workspace and blocks escapes', async () => {
    const resolved = await workspace.resolveExistingFile('sample.txt');
    assert.strictEqual(resolved, path.join(tempDir, 'sample.txt'));

    await assert.rejects(
      async () => {
        await workspace.resolveExistingFile('../outside.txt');
      },
      /Path escapes workspace/,
      'Should reject paths escaping workspace',
    );
  });

  test('llm.js defaults to model-router configuration', () => {
    const provider = createProvider();
    assert.strictEqual(provider.model, 'model-router-auto');
    assert.strictEqual(provider.baseURL, 'http://localhost:8787/v1');
    assert.strictEqual(provider.apiKey, 'dummy');
  });

  test('llm.js respects custom options and environment variables', () => {
    const provider = createProvider({
      model: 'claude-3-5-sonnet',
      baseURL: 'http://localhost:9999/v1',
      apiKey: 'custom-key',
    });
    assert.strictEqual(provider.model, 'claude-3-5-sonnet');
    assert.strictEqual(provider.baseURL, 'http://localhost:9999/v1');
    assert.strictEqual(provider.apiKey, 'custom-key');
  });

  test('start.js parseArgs correctly parses flags and arguments', () => {
    const parsed = parseArgs(['node', 'start.js', '-y', '--dir', '/tmp', '--model', 'codestral-latest', 'Refactor code']);
    assert.strictEqual(parsed.autoApprove, true);
    assert.strictEqual(parsed.workspaceDir, '/tmp');
    assert.strictEqual(parsed.customModel, 'codestral-latest');
    assert.strictEqual(parsed.task, 'Refactor code');
  });

  test('permissions.js handles autoApprove and custom ask or rl', async () => {
    const permsAuto = createPermissions({ autoApprove: true });
    const mockTool = { needsApproval: true, trust: () => 'always', describe: () => 'test tool' };
    const approvedAuto = await permsAuto.approve(mockTool, {});
    assert.strictEqual(approvedAuto, true);
    permsAuto.close();

    let askedDescription = null;
    const permsAsk = createPermissions({
      autoApprove: false,
      ask: (desc) => {
        askedDescription = desc;
        return true;
      },
    });
    const approvedAsk = await permsAsk.approve(mockTool, {});
    assert.strictEqual(approvedAsk, true);
    assert.strictEqual(askedDescription, 'test tool');
    permsAsk.close();

    let mockQuestionCalled = false;
    const mockRl = {
      question: async () => {
        mockQuestionCalled = true;
        return 'y';
      },
      close: () => {},
    };
    const permsRl = createPermissions({ autoApprove: false, rl: mockRl });
    const approvedRl = await permsRl.approve(mockTool, {});
    assert.strictEqual(approvedRl, true);
    assert.strictEqual(mockQuestionCalled, true);
    permsRl.close();
  });

  test('customizations.js parseFrontmatter extracts YAML metadata and body', () => {
    const raw = '---\ndescription: Test workflow\nauthor: mini-agent\n---\n# Step 1\nRun test';
    const parsed = parseFrontmatter(raw);
    assert.strictEqual(parsed.metadata.description, 'Test workflow');
    assert.strictEqual(parsed.metadata.author, 'mini-agent');
    assert.strictEqual(parsed.body, '# Step 1\nRun test');

    const noFrontmatter = '# No frontmatter\nJust body';
    const parsedNoFm = parseFrontmatter(noFrontmatter);
    assert.deepStrictEqual(parsedNoFm.metadata, {});
    assert.strictEqual(parsedNoFm.body, noFrontmatter);
  });

  test('customizations.js discovers workflows and skills from workspace', async () => {
    const wfDir = path.join(tempDir, '.agents', 'workflows');
    await fs.mkdir(wfDir, { recursive: true });
    await fs.writeFile(
      path.join(wfDir, 'deploy.md'),
      '---\ndescription: Deploy workflow\n---\nRun deployment script',
    );

    const workflows = await loadWorkflows(tempDir);
    const deployWf = workflows.find((w) => w.name === 'deploy');
    assert.ok(deployWf, 'Should discover deploy workflow');
    assert.strictEqual(deployWf.command, '/deploy');
    assert.strictEqual(deployWf.description, 'Deploy workflow');
    assert.strictEqual(deployWf.content, 'Run deployment script');

    const skillDir = path.join(tempDir, '.agents', 'skills', 'git-helper');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: git-helper\ndescription: Git assist skill\n---\nFollow git guidelines',
    );

    const skills = await loadSkills(tempDir);
    const gitSkill = skills.find((s) => s.name === 'git-helper');
    assert.ok(gitSkill, 'Should discover git-helper skill');
    assert.strictEqual(gitSkill.description, 'Git assist skill');
    assert.strictEqual(gitSkill.content, 'Follow git guidelines');

    const promptText = formatCustomizationsPrompt({ workflows, skills });
    assert.ok(promptText.includes('## Workflows'), 'Prompt includes workflows header');
    assert.ok(promptText.includes('/deploy'), 'Prompt includes /deploy');
    assert.ok(promptText.includes('## Skills'), 'Prompt includes skills header');
    assert.ok(promptText.includes('git-helper'), 'Prompt includes git-helper');
  });

  test('customizations.js resolveWorkflowCommand correctly parses slash commands', () => {
    const mockWorkflows = [
      { name: 'review', command: '/review', content: 'Do review', description: 'Review code' },
    ];

    const matchedExact = resolveWorkflowCommand('/review', mockWorkflows);
    assert.strictEqual(matchedExact.matched, true);
    assert.strictEqual(matchedExact.prompt, 'Do review');

    const matchedWithArgs = resolveWorkflowCommand('/review check start.js', mockWorkflows);
    assert.strictEqual(matchedWithArgs.matched, true);
    assert.ok(matchedWithArgs.prompt.includes('User context/input: check start.js'));

    const unmatched = resolveWorkflowCommand('/unknown', mockWorkflows);
    assert.strictEqual(unmatched.matched, false);
    assert.strictEqual(unmatched.commandName, 'unknown');

    const notCommand = resolveWorkflowCommand('normal message', mockWorkflows);
    assert.strictEqual(notCommand, null);
  });
});
