import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const GIT_TIMEOUT_MS = 5_000;
const execFileAsync = promisify(execFile);

export interface GitInfo {
  name: string;
  branch: string;
  hash: string;
  dirty: boolean;
}

export const git = async (args: string[], cwd: string): Promise<string> => {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
  return stdout.trim();
};

export const findGitRoot = async (cwd: string): Promise<string | null> => {
  try {
    const root = await git(['rev-parse', '--show-toplevel'], cwd);
    if (!root) return null;
    return path.resolve(root);
  } catch {
    // not a git repo, or git is unavailable
    return null;
  }
};

export const loadGitInfo = async (cwd: string): Promise<GitInfo> => {
  const name = path.basename(cwd);
  try {
    const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
    const hash = await git(['rev-parse', '--short', 'HEAD'], cwd);
    const status = await git(['status', '--porcelain'], cwd);
    return { name, branch, hash, dirty: status.length > 0 };
  } catch {
    // not a git repo, or git is unavailable
    return { name, branch: '', hash: '', dirty: false };
  }
};
