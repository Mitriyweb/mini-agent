import fs from 'node:fs/promises';
import path from 'node:path';

import { atomicWriteFile } from '../utils/textfile.ts';

export const DEFAULT_MEMORY_PATH = '.mini-agent/memory.md';
export const DEFAULT_MEMORY_MAX_BYTES = 8 * 1024;
export const DEFAULT_MEMORY_MAX_ENTRIES = 50;

export interface MemoryOptions {
  maxBytes?: number;
  maxEntries?: number;
}

export interface AddMemoryResult {
  created: boolean;
  content: string;
  path: string;
}

const normalizeOptions = (options?: MemoryOptions): Required<MemoryOptions> => ({
  maxBytes: Math.max(1, options?.maxBytes ?? DEFAULT_MEMORY_MAX_BYTES),
  maxEntries: Math.max(1, options?.maxEntries ?? DEFAULT_MEMORY_MAX_ENTRIES),
});

const normalizeNewlines = (value: string): string => value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const readMemoryText = async (workspaceRoot: string): Promise<{ exists: boolean; content: string; path: string }> => {
  const memoryPath = path.join(workspaceRoot, DEFAULT_MEMORY_PATH);

  try {
    const content = await fs.readFile(memoryPath, 'utf8');
    return { exists: true, content: normalizeNewlines(content), path: memoryPath };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return { exists: false, content: '', path: memoryPath };
    }
    throw error;
  }
};

const parseMemoryEntries = (content: string): { header: string; entries: string[] } => {
  const normalized = normalizeNewlines(content).trim();
  if (!normalized) {
    return { header: '# Project Memory', entries: [] };
  }

  const lines = normalized.split('\n');
  const header: string[] = [];
  const entries: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith('- ')) {
      const entryText = line.slice(2).trim();
      if (entryText) entries.push(entryText);
      continue;
    }

    if (line.trim() === '') {
      if (entries.length > 0 || header.length > 0) {
        header.push(line);
      }
      continue;
    }

    header.push(line);
  }

  const normalizedHeader = header
    .join('\n')
    .trim()
    .replace(/^#\s*Project Memory\s*$/i, '# Project Memory')
    .trim();

  return {
    header: normalizedHeader || '# Project Memory',
    entries,
  };
};

const formatMemoryContent = (entries: string[], header = '# Project Memory'): string => {
  const body = entries.map((entry) => `- ${entry.trim()}`);
  return [header.trim(), '', ...body, ''].join('\n');
};

const trimEntriesToFit = (entries: string[], maxBytes: number): string[] => {
  if (entries.length === 0) return [];

  const header = '# Project Memory';
  const firstTry = formatMemoryContent(entries, header);

  if (Buffer.byteLength(firstTry, 'utf8') <= maxBytes) {
    return entries;
  }

  const bounded = [...entries].slice(-1);
  const firstPass = formatMemoryContent(bounded, header);

  if (Buffer.byteLength(firstPass, 'utf8') <= maxBytes) {
    return bounded;
  }

  let trimmedEntries = [...entries];
  while (trimmedEntries.length > 0) {
    const candidate = formatMemoryContent(trimmedEntries, header);
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) return trimmedEntries;

    if (trimmedEntries.length === 1) {
      const entry = trimmedEntries[0].trim();
      const prefix = `${header}\n\n- `;
      const available = Math.max(0, maxBytes - Buffer.byteLength(prefix, 'utf8') - 1);
      trimmedEntries = [entry.slice(0, available)];
      if (trimmedEntries[0].length === 0) {
        return [];
      }
      return trimmedEntries;
    }

    trimmedEntries.shift();
  }

  return [];
};

const buildMemoryContent = (entries: string[], options: Required<MemoryOptions>): string => {
  const boundedEntries = entries.slice(-options.maxEntries);
  const trimmedEntries = trimEntriesToFit(boundedEntries, options.maxBytes);
  return formatMemoryContent(trimmedEntries, '# Project Memory');
};

export const loadProjectMemory = async (
  workspaceRoot: string,
  options: MemoryOptions = {},
): Promise<string> => {
  const resolvedOptions = normalizeOptions(options);
  const { exists, content } = await readMemoryText(workspaceRoot);

  if (!exists || !content.trim()) {
    return '';
  }

  const { entries } = parseMemoryEntries(content);
  const boundedEntries = entries.slice(-resolvedOptions.maxEntries);
  const trimmedEntries = trimEntriesToFit(boundedEntries, resolvedOptions.maxBytes);
  const trimmedContent = formatMemoryContent(trimmedEntries, '# Project Memory');

  return `<project_memory>\n${trimmedContent.trim()}\n</project_memory>`;
};

export const addMemoryEntry = async (
  workspaceRoot: string,
  newEntry: string,
  options: MemoryOptions = {},
): Promise<AddMemoryResult> => {
  const normalizedEntry = newEntry.trim();
  if (!normalizedEntry) {
    throw new Error('Memory entry cannot be empty.');
  }

  const resolvedOptions = normalizeOptions(options);
  const { exists, content, path: memoryPath } = await readMemoryText(workspaceRoot);

  const { entries } = parseMemoryEntries(content);
  const nextEntries = [...entries, normalizedEntry];
  const nextContent = buildMemoryContent(nextEntries, resolvedOptions);

  await fs.mkdir(path.dirname(memoryPath), { recursive: true });
  await atomicWriteFile(memoryPath, nextContent);

  return {
    created: !exists,
    content: nextContent,
    path: memoryPath,
  };
};
