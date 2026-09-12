import fs from 'node:fs';
import path from 'node:path';
import concolor from 'concolor';

export type LogLevel = 'off' | 'normal' | 'verbose';

export interface LoggingConfig {
  level: LogLevel;
  filePath?: string;
}

const color = (concolor as any)({
  info: 'b,blue',
  warn: 'b,yellow',
  error: 'b,red',
  success: 'b,green',
  cyan: 'b,cyan',
  dim: 'gray',
});

export const redactSecrets = (data: unknown): unknown => {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') {
    let result = data;
    // Mask API keys like sk-..., gsk_..., etc.
    result = result.replace(/(sk-[a-zA-Z0-9_-]{10,})/g, 'sk-***[REDACTED]***');
    result = result.replace(/(gsk_[a-zA-Z0-9_-]{10,})/g, 'gsk_***[REDACTED]***');
    // Mask Bearer tokens
    result = result.replace(/(Bearer\s+)[a-zA-Z0-9_.\--]+/gi, '$1***[REDACTED]***');
    // Mask standard header values like Authorization: ... or x-api-key: ...
    result = result.replace(/((?:authorization|x-api-key|api-key|secret|password)\s*[:=]\s*)(["']?)[^\s"']+\2/gi, '$1$2***[REDACTED]***$2');
    return result;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redactSecrets(item));
  }
  if (typeof data === 'object') {
    const redactedObj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey.includes('authorization') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('token')
      ) {
        redactedObj[key] = '***[REDACTED]***';
      } else {
        redactedObj[key] = redactSecrets(val);
      }
    }
    return redactedObj;
  }
  return data;
};

export interface LoggerOptions {
  level?: LogLevel;
  writer?: (message: string) => void;
  filePath?: string;
}

export class Logger {
  public level: LogLevel;
  private writer: (message: string) => void;
  private filePath?: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'normal';
    this.filePath = options.filePath ? path.resolve(options.filePath) : undefined;

    const baseWriter = options.writer ?? ((msg) => console.log(msg));

    if (this.filePath) {
      const dirPath = path.dirname(this.filePath);
      fs.mkdirSync(dirPath, { recursive: true });
      fs.closeSync(fs.openSync(this.filePath, 'a'));

      this.writer = (msg) => {
        fs.appendFileSync(this.filePath!, `${msg}\n`, 'utf8');
      };
    } else {
      this.writer = baseWriter;
    }
  }

  public isOff(): boolean {
    return this.level === 'off';
  }

  public hasFilePath(): boolean {
    return this.filePath !== undefined;
  }

  public isVerbose(): boolean {
    return this.level === 'verbose';
  }

  public logNormal(message: string): void {
    if (this.level === 'off') return;
    this.writer(message);
  }

  public logVerbose(message: string, meta?: unknown): void {
    if (this.level !== 'verbose') return;
    let formatted = `[VERBOSE] ${message}`;
    if (meta !== undefined) {
      const redacted = redactSecrets(meta);
      const serialized = typeof redacted === 'string' ? redacted : JSON.stringify(redacted, null, 2);
      formatted += `\n${color.dim(serialized)}`;
    }
    this.writer(color.dim(formatted));
  }

  public logError(message: string, error?: unknown): void {
    if (this.level === 'off') return;
    let text = `${color.error('ERROR:')} ${message}`;
    if (error !== undefined) {
      const redactedErr = redactSecrets(error);
      if (redactedErr instanceof Error) {
        text += `\n${redactedErr.message}`;
        if (this.level === 'verbose' && redactedErr.stack) {
          text += `\n${redactedErr.stack}`;
        }
      } else if (typeof redactedErr === 'object' && redactedErr !== null) {
        text += `\n${JSON.stringify(redactedErr, null, 2)}`;
      } else {
        text += ` ${redactedErr}`;
      }
    }
    this.writer(text);
  }
}
