import fs from 'node:fs/promises';
import path from 'node:path';

const SKIP_NAMES = ['node_modules', '.git', 'dist', 'coverage', '.cursor'];

export const isSkippedName = (name: string): boolean => SKIP_NAMES.includes(name);

export const isSkippedRel = (rel: string): boolean => {
  const parts = (rel ?? '').split(/[/\\]/);
  for (const part of parts) {
    if (isSkippedName(part)) return true;
  }
  return false;
};

export type VisitCallback = (absPath: string, relPath: string) => Promise<boolean | void> | boolean | void;

export const walkFiles = async (
  absDir: string,
  relativeDir: string,
  visit: VisitCallback,
): Promise<boolean> => {
  const entries = await fs.readdir(absDir, { withFileTypes: true });
  for (const dirent of entries) {
    if (isSkippedName(dirent.name)) continue;
    const absPath = path.join(absDir, dirent.name);
    const relPath = relativeDir ? `${relativeDir}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      const stop = await walkFiles(absPath, relPath, visit);
      if (stop) return true;
      continue;
    }
    if (!dirent.isFile()) continue;
    const stop = await visit(absPath, relPath);
    if (stop) return true;
  }
  return false;
};
