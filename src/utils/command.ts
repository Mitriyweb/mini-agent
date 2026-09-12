import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { truncateOutput } from './textfile.ts';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 1024 * 1024;

const execOptions = (cwd: string) => ({
  cwd,
  timeout: COMMAND_TIMEOUT_MS,
  maxBuffer: MAX_BUFFER,
  windowsHide: true,
});

const joinOutput = (lines: string[]): string => {
  const present = lines.filter((line) => line !== '');
  const text = present.join('\n');
  return truncateOutput(text);
};

const formatSuccess = (stdout = '', stderr = ''): string => {
  const stdoutBlock = stdout ? `stdout:\n${stdout}` : '';
  const stderrBlock = stderr ? `stderr:\n${stderr}` : '';
  return joinOutput(['exit_code: 0', stdoutBlock, stderrBlock]);
};

const formatFailure = (error: any): string => {
  const timedOut = error?.killed && error?.signal === 'SIGTERM';
  if (timedOut) {
    const seconds = COMMAND_TIMEOUT_MS / 1000;
    const notice = `Command exceeded the ${seconds} second timeout.`;
    return `exit_code: timeout\n${notice}`;
  }
  const exitCode = error?.code ?? 'unknown';
  const stdout = error?.stdout ? `stdout:\n${error.stdout}` : '';
  const stderr = error?.stderr ? `stderr:\n${error.stderr}` : '';
  const hasOutput = stdout !== '' || stderr !== '';
  const fallback = hasOutput ? '' : `error:\n${error.message}`;
  return joinOutput([`exit_code: ${exitCode}`, stdout, stderr, fallback]);
};

export const runCommand = async (command: string, cwd: string): Promise<string> => {
  try {
    const result = await execAsync(command, execOptions(cwd));
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    return formatSuccess(stdout, stderr);
  } catch (error) {
    return formatFailure(error);
  }
};

export const runFile = async (command: string, args: string[], cwd: string): Promise<string> => {
  try {
    const result = await execFileAsync(command, args, execOptions(cwd));
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    return formatSuccess(stdout, stderr);
  } catch (error) {
    return formatFailure(error);
  }
};
