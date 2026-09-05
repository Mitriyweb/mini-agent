import fs from 'node:fs/promises';
import path from 'node:path';
import { isUtf8 } from 'node:buffer';

const BINARY_PROBE = 8 * 1024;
const MAX_OUTPUT_CHARS = 50_000;

export const isBinaryBuffer = (buf: Buffer): boolean => {
  const n = Math.min(buf.length, BINARY_PROBE);
  for (let i = 0; i < n; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
};

export const assertTextBuffer = (buf: Buffer, label = 'content'): void => {
  if (isBinaryBuffer(buf)) {
    throw new Error(`${label} looks binary (NUL in the first 8 KiB).`);
  }
  if (typeof isUtf8 === 'function' && !isUtf8(buf)) {
    throw new Error(`${label} is not valid UTF-8.`);
  }
};

export const readTextFile = async (filePath: string): Promise<string> => {
  const buf = await fs.readFile(filePath);
  assertTextBuffer(buf, filePath);
  return buf.toString('utf8');
};

export const unlinkQuiet = async (filePath: string): Promise<void> => {
  try {
    await fs.unlink(filePath);
  } catch {
    // ignore cleanup failure
  }
};

export const atomicWriteFile = async (filePath: string, content: string): Promise<void> => {
  const buf = Buffer.from(content);
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, filePath);
  } catch (error) {
    await unlinkQuiet(tmp);
    throw error;
  }
};

export const truncateOutput = (text: string, maxChars = MAX_OUTPUT_CHARS): string => {
  if (text.length <= maxChars) return text;
  const truncated = text.slice(0, maxChars);
  return `${truncated}\n...[output truncated]`;
};

export const formatNumberedLines = (lines: string[], startLine: number, totalLines: number): string => {
  if (totalLines === 0) return '(empty file)';
  if (lines.length === 0) {
    return `(no lines at offset ${startLine}; file has ${totalLines} lines)`;
  }
  const endLine = startLine + lines.length - 1;
  const width = `${totalLines}`.length;
  const body = lines.map((line, index) => {
    const num = startLine + index;
    const label = `${num}`.padStart(width, ' ');
    return `${label}|${line}`;
  });
  const remaining = totalLines - endLine;
  if (remaining > 0) body.push(`... ${remaining} lines not shown`);
  return body.join('\n');
};

/**
 * Normalizes CRLF and LF line endings in text to standard LF (\n),
 * or matches substring irrespective of newline styles.
 */
export const normalizeNewlines = (text: string): string => {
  return text.replace(/\r\n/g, '\n');
};
