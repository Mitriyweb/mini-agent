import { describe, expect, it } from 'bun:test';
import { Workspace } from '../src/agent/workspace.js';
import { createOpenspecTool } from '../src/tools/openspec.js';

describe('OpenSpec Specifications Test Suite', () => {
  it('validates core openspec.yaml file successfully', async () => {
    const workspace = await Workspace.open(process.cwd());
    const openspecTool = createOpenspecTool({ workspace });

    const info = await openspecTool.execute({ path: 'openspec/openspec.yaml', operation: 'info' });
    expect(info).toContain('mini-agent Specification');
    expect(info).toContain('0.1.15');

    const validation = await openspecTool.execute({ path: 'openspec/openspec.yaml', operation: 'validate' });
    expect(validation).toContain('No critical or warning issues found');

    const paths = await openspecTool.execute({ path: 'openspec/openspec.yaml', operation: 'paths' });
    expect(paths).toContain('/agent/run');
    expect(paths).toContain('/tools/openspec');
  });

  it('validates tools.yaml spec file successfully', async () => {
    const workspace = await Workspace.open(process.cwd());
    const openspecTool = createOpenspecTool({ workspace });

    const info = await openspecTool.execute({ path: 'openspec/specs/tools.yaml', operation: 'info' });
    expect(info).toContain('mini-agent Tools Specification');

    const validation = await openspecTool.execute({ path: 'openspec/specs/tools.yaml', operation: 'validate' });
    expect(validation).toContain('No critical or warning issues found');

    const operations = await openspecTool.execute({
      path: 'openspec/specs/tools.yaml',
      operation: 'operations',
      path_filter: '/tools/read',
    });
    expect(operations).toContain('GET /tools/read');
  });

  it('validates agent.yaml spec file successfully', async () => {
    const workspace = await Workspace.open(process.cwd());
    const openspecTool = createOpenspecTool({ workspace });

    const info = await openspecTool.execute({ path: 'openspec/specs/agent.yaml', operation: 'info' });
    expect(info).toContain('mini-agent Core & Subsystems Specification');

    const validation = await openspecTool.execute({ path: 'openspec/specs/agent.yaml', operation: 'validate' });
    expect(validation).toContain('No critical or warning issues found');

    const paths = await openspecTool.execute({ path: 'openspec/specs/agent.yaml', operation: 'paths' });
    expect(paths).toContain('/agent/loop');
    expect(paths).toContain('/agent/permissions');
  });
});
