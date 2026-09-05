const GLOB_TOKEN = /\*\*\/?|\*|\?|[^*?]+/g;

const GLOB_ATOM: Record<string, string> = {
  '**/': '.*',
  '**': '.*',
  '*': '[^/]*',
  '?': '[^/]',
};

export const escapeRegExp = (text: string): string => text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

export const toPosix = (value: string): string => value.replaceAll('\\', '/');

export const globToRegExp = (pattern: string): RegExp => {
  if (typeof pattern !== 'string' || pattern.length === 0) {
    throw new Error('glob pattern must be a non-empty string.');
  }
  const normalized = toPosix(pattern);
  const tokens = normalized.match(GLOB_TOKEN) ?? [];
  const atoms = tokens.map((token) => GLOB_ATOM[token] ?? escapeRegExp(token));
  const source = `^${atoms.join('')}$`;
  return new RegExp(source);
};

export const matchGlob = (relativePath: string, pattern: string): boolean => {
  const posix = toPosix(relativePath);
  const re = globToRegExp(pattern);
  if (re.test(posix)) return true;
  const base = posix.slice(posix.lastIndexOf('/') + 1);
  return re.test(base);
};
