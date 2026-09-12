import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Logger, redactSecrets } from '../src/agent/logging.js';
import { createEventHandler, parseArgs } from '../src/start.js';
import { resolveAgentConfig } from '../src/agent/config.js';

describe('Logging Subsystem Test Suite', () => {
  it('redactSecrets masks API keys, bearer tokens, and sensitive headers', () => {
    const raw = {
      apiKey: 'sk-1234567890abcdef123456',
      authorization: 'Bearer secret_token_xyz',
      password: 'myPassword123',
      nested: {
        gskField: 'gsk_abcdef1234567890',
        text: 'Authorization: Bearer mySecretToken',
      },
    };

    const redacted = redactSecrets(raw) as any;
    expect(redacted.apiKey).toBe('***[REDACTED]***');
    expect(redacted.authorization).toBe('***[REDACTED]***');
    expect(redacted.password).toBe('***[REDACTED]***');
    expect(redacted.nested.gskField).toBe('gsk_***[REDACTED]***');
    expect(redacted.nested.text).toContain('Authorization:');
    expect(redacted.nested.text).toContain('***[REDACTED]***');

    expect(redactSecrets('sk-123456789012345')).toBe('sk-***[REDACTED]***');
    expect(redactSecrets('gsk_123456789012345')).toBe('gsk_***[REDACTED]***');
  });

  it('Logger with "off" level suppresses all logs', () => {
    const logs: string[] = [];
    const logger = new Logger({ level: 'off', writer: (msg) => logs.push(msg) });

    logger.logNormal('normal message');
    logger.logVerbose('verbose message');
    logger.logError('error message');

    expect(logs.length).toBe(0);
  });

  it('Logger with "normal" level logs normal messages but skips verbose details', () => {
    const logs: string[] = [];
    const logger = new Logger({ level: 'normal', writer: (msg) => logs.push(msg) });

    logger.logNormal('normal message');
    logger.logVerbose('verbose message');

    expect(logs.length).toBe(1);
    expect(logs[0]).toBe('normal message');
  });

  it('Logger with "verbose" level logs both normal and verbose details with redaction', () => {
    const logs: string[] = [];
    const logger = new Logger({ level: 'verbose', writer: (msg) => logs.push(msg) });

    logger.logNormal('normal event');
    logger.logVerbose('verbose event', { apiKey: 'sk-1234567890123' });

    expect(logs.length).toBe(2);
    expect(logs[0]).toBe('normal event');
    expect(logs[1]).toContain('[VERBOSE] verbose event');
    expect(logs[1]).toContain('***[REDACTED]***');
  });

  it('CLI --log-level overrides config default', () => {
    const cliOptions = parseArgs(['node', 'start.js', '--log-level', 'verbose']);
    const config = resolveAgentConfig({ logging: cliOptions.logLevel ? { level: cliOptions.logLevel } : undefined });

    expect(config.logging.level).toBe('verbose');
  });

  it('resolves a default log file in the current working directory when logging is enabled', () => {
    const config = resolveAgentConfig({ logging: { level: 'normal' } });

    expect(config.logging.filePath).toBe(path.join(process.cwd(), 'mini-agent.log'));
  });

  it('Logger creates the configured file immediately on construction', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-log-test-'));
    const logFile = path.join(tempDir, 'mini-agent.log');

    try {
      const logger = new Logger({ level: 'normal', filePath: logFile });

      expect(await fs.access(logFile).then(() => true).catch(() => false)).toBe(true);
      expect(logger.isOff()).toBe(false);

      logger.logNormal('file log message');

      const contents = await fs.readFile(logFile, 'utf8');
      expect(contents).toContain('file log message');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Logger writes messages only to the configured file when file logging is enabled', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-log-test-'));
    const logFile = path.join(tempDir, 'mini-agent.log');
    const originalConsoleLog = console.log;
    const loggedToConsole: string[] = [];

    try {
      console.log = (...args: any[]) => {
        loggedToConsole.push(args.join(' '));
      };

      const logger = new Logger({ level: 'normal', filePath: logFile });
      logger.logNormal('file log message');

      const contents = await fs.readFile(logFile, 'utf8');
      expect(contents).toContain('file log message');
      expect(loggedToConsole).toEqual([]);
    } finally {
      console.log = originalConsoleLog;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('createEventHandler keeps assistant output out of file logs while still printing it to the terminal', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-log-test-'));
    const logFile = path.join(tempDir, 'mini-agent.log');
    const originalConsoleLog = console.log;
    const loggedToConsole: string[] = [];

    try {
      console.log = (...args: any[]) => {
        loggedToConsole.push(args.join(' '));
      };

      const logger = new Logger({ level: 'normal', filePath: logFile });
      const onEvent = createEventHandler(logger);

      await onEvent({ type: 'assistant', text: 'assistant reply text' } as any);

      const contents = await fs.readFile(logFile, 'utf8');
      expect(contents).toBe('');
      expect(loggedToConsole.join('\n')).toContain('assistant reply text');
    } finally {
      console.log = originalConsoleLog;
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('Logger writes messages to a file when configured', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mini-agent-log-test-'));
    const logFile = path.join(tempDir, 'mini-agent.log');

    try {
      const logger = new Logger({ level: 'normal', filePath: logFile });

      logger.logNormal('file log message');

      const contents = await fs.readFile(logFile, 'utf8');
      expect(contents).toContain('file log message');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
