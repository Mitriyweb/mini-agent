import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { addMemoryEntry, loadProjectMemory } from '../src/agent/memory.ts';

describe('Memory subsystem', () => {
  it('creates a structured memory file and wraps it for prompt context', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-memory-'));
    try {
      const result = await addMemoryEntry(tmpDir, 'Remember this fact', {
        maxBytes: 4096,
        maxEntries: 25,
      });

      expect(result.created).toBe(true);
      expect(result.content).toContain('# Project Memory');
      expect(result.content).toContain('Remember this fact');

      const memoryPath = path.join(tmpDir, '.mini-agent', 'memory.md');
      const onDisk = await fs.readFile(memoryPath, 'utf8');
      expect(onDisk).toContain('Remember this fact');

      const prompt = await loadProjectMemory(tmpDir, {
        maxBytes: 4096,
        maxEntries: 25,
      });

      expect(prompt).toContain('<project_memory>');
      expect(prompt).toContain('Remember this fact');
      expect(prompt).toContain('</project_memory>');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('drops oldest entries when the memory budget is exceeded', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-memory-budget-'));
    try {
      await addMemoryEntry(tmpDir, 'entry 1', {
        maxBytes: 30,
        maxEntries: 5,
      });
      await addMemoryEntry(tmpDir, 'entry 2', {
        maxBytes: 30,
        maxEntries: 5,
      });
      await addMemoryEntry(tmpDir, 'entry 3', {
        maxBytes: 30,
        maxEntries: 5,
      });

      const memoryPath = path.join(tmpDir, '.mini-agent', 'memory.md');
      const content = await fs.readFile(memoryPath, 'utf8');

      expect(content).toContain('entry 3');
      expect(content).not.toContain('entry 1');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
