import fs from 'node:fs/promises';
import path from 'node:path';
import { findGitRoot } from '../utils/git.js';
import type { PathResolution } from '../types/workspace.js';

export const isInside = (root: string, candidate: string): boolean => {
  const prefix = root + path.sep;
  return candidate === root || candidate.startsWith(prefix);
};

export const nearestExistingAncestor = async (candidate: string): Promise<string> => {
  let current = candidate;
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
};

export interface ResolveFileOptions {
  mustExist?: boolean;
}

export class Workspace {
  readonly root: string;
  readonly realRoot: string;
  readonly gitRoot: string | null;

  constructor(root: string, realRoot: string, gitRoot: string | null) {
    this.root = root;
    this.realRoot = realRoot;
    this.gitRoot = gitRoot;
  }

  static async open(rootPath?: string): Promise<Workspace> {
    const lexicalRoot = path.resolve(rootPath ?? process.cwd());
    const realRoot = await fs.realpath(lexicalRoot);
    const gitRoot = await findGitRoot(lexicalRoot);
    return new Workspace(lexicalRoot, realRoot, gitRoot);
  }

  async resolveFile(relativePath: string, options: ResolveFileOptions = {}): Promise<string> {
    const mustExist = options.mustExist ?? false;

    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('Path must be a non-empty string.');
    }

    if (path.isAbsolute(relativePath)) {
      throw new Error('Only paths relative to the workspace are allowed.');
    }

    const lexicalTarget = path.resolve(this.root, relativePath);
    if (!isInside(this.root, lexicalTarget)) {
      throw new Error(`Path escapes workspace: ${relativePath}`);
    }

    if (mustExist) {
      const realTarget = await fs.realpath(lexicalTarget);
      if (!isInside(this.realRoot, realTarget)) {
        throw new Error(`Path resolves outside workspace: ${relativePath}`);
      }
      return lexicalTarget;
    }

    const ancestor = await nearestExistingAncestor(lexicalTarget);
    const realAncestor = await fs.realpath(ancestor);
    if (!isInside(this.realRoot, realAncestor)) {
      throw new Error(`Path resolves outside workspace: ${relativePath}`);
    }

    return lexicalTarget;
  }

  resolveExistingFile(relativePath: string): Promise<string> {
    return this.resolveFile(relativePath, { mustExist: true });
  }

  resolveWritableFile(relativePath: string): Promise<string> {
    return this.resolveFile(relativePath, { mustExist: false });
  }

  async resolveExistingPath(relativePath?: string): Promise<PathResolution> {
    const empty = relativePath === undefined || relativePath === '';
    const target = empty ? '.' : relativePath;
    const lexicalTarget = await this.resolveFile(target, { mustExist: true });
    const stat = await fs.lstat(lexicalTarget);
    const isFile = stat.isFile();
    const isDirectory = stat.isDirectory();
    return { path: lexicalTarget, isFile, isDirectory };
  }
}
