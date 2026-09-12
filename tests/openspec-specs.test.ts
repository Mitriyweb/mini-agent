import { describe, expect, it } from 'bun:test';
import { Workspace } from '../src/agent/workspace.js';
import { createOpenspecTool } from '../src/tools/openspec.js';

describe('OpenSpec Specifications Test Suite', () => {
  it('validates root openspec.yaml and openspec.json files successfully', async () => {
    const workspace = await Workspace.open(process.cwd());
    const openspecTool = createOpenspecTool({ workspace });

    const infoYaml = await openspecTool.execute({ path: 'openspec/openspec.yaml', operation: 'info' });
    expect(infoYaml).toContain('mini-agent Specification');
    expect(infoYaml).toContain('0.1.15');

    const valYaml = await openspecTool.execute({ path: 'openspec/openspec.yaml', operation: 'validate' });
    expect(valYaml).toContain('No critical or warning issues found');

    const infoJson = await openspecTool.execute({ path: 'openspec/openspec.json', operation: 'info' });
    expect(infoJson).toContain('mini-agent Core OpenSpec');

    const valJson = await openspecTool.execute({ path: 'openspec/openspec.json', operation: 'validate' });
    expect(valJson).toContain('No critical or warning issues found');
  });

  it('validates domain spec.yaml files across all subdirectories', async () => {
    const workspace = await Workspace.open(process.cwd());
    const openspecTool = createOpenspecTool({ workspace });

    const domains = ['agent', 'tools', 'permissions', 'workspace', 'providers'];

    for (const domain of domains) {
      const specPath = `openspec/specs/${domain}/spec.yaml`;
      const validation = await openspecTool.execute({ path: specPath, operation: 'validate' });
      expect(validation).toContain('No critical or warning issues found');

      const info = await openspecTool.execute({ path: specPath, operation: 'info' });
      expect(info).toContain('mini-agent');
    }
  });
});
