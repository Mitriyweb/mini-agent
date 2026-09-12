import { describe, expect, it } from 'bun:test';
import { resolveSystemPrompt } from '../src/agent/system-prompt.js';
import { INSTRUCTIONS } from '../src/agent/instructions.js';
import { parseArgs } from '../src/start.js';
import { resolveAgentConfig } from '../src/agent/config.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('System Prompt Subsystem Test Suite', () => {
  it('returns default INSTRUCTIONS when enabled is true and no custom path', async () => {
    const prompt = await resolveSystemPrompt({ enabled: true });
    expect(prompt).toBe(INSTRUCTIONS);
  });

  it('returns empty string when system prompt is disabled', async () => {
    const prompt = await resolveSystemPrompt({ enabled: false });
    expect(prompt).toBe('');
  });

  it('loads custom system prompt file when path is specified', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-sysprompt-test-'));
    const customFilePath = path.join(tempDir, 'custom-prompt.md');
    await fs.writeFile(customFilePath, 'Custom system prompt content.', 'utf8');

    const prompt = await resolveSystemPrompt({ enabled: true, path: customFilePath });
    expect(prompt).toBe('Custom system prompt content.');

    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('CLI --no-system-prompt flag disables default system prompt', () => {
    const cliOptions = parseArgs(['node', 'start.js', '--no-system-prompt']);
    const config = resolveAgentConfig({
      systemPrompt: cliOptions.systemPromptEnabled !== undefined ? { enabled: cliOptions.systemPromptEnabled } : undefined,
    });

    expect(config.systemPrompt.enabled).toBe(false);
  });
});
