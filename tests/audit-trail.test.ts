import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { AuditLogger } from '../src/agent/logging.js';

describe('audit-trail capability', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-audit-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes append-only JSONL records with required fields', () => {
    const logger = new AuditLogger(tmpDir);
    const runId = 'test-run-1';
    
    logger.logEvent(runId, 'test_event', { custom_meta: 'value' });
    
    const auditFile = path.join(tmpDir, '.mini-agent', 'audit.jsonl');
    const content = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    expect(content.length).toBe(1);
    
    const record = JSON.parse(content[0]);
    expect(record.timestamp).toBeDefined();
    expect(record.runId).toBe(runId);
    expect(record.event).toBe('test_event');
    expect(record.custom_meta).toBe('value');
  });

  it('redacts sensitive output before writing', () => {
    const logger = new AuditLogger(tmpDir);
    const runId = 'test-run-2';
    
    logger.logEvent(runId, 'tool_result', { 
      output: 'Bearer sk-abcdef1234567890',
      api_key: 'gsk_supersecretkey1234'
    });
    
    const auditFile = path.join(tmpDir, '.mini-agent', 'audit.jsonl');
    const record = JSON.parse(fs.readFileSync(auditFile, 'utf8').trim());
    
    expect(record.output).toContain('***[REDACTED]***');
    expect(record.output).not.toContain('sk-abcdef');
    expect(record.api_key).toBe('***[REDACTED]***');
  });

  it('is best-effort and non-fatal when audit directory cannot be created', () => {
    // Creating a file where a directory should be to force a failure
    const badPath = path.join(tmpDir, '.mini-agent');
    fs.writeFileSync(badPath, 'not a directory');
    
    // Should not throw
    const logger = new AuditLogger(tmpDir);
    expect(() => logger.logEvent('run', 'event')).not.toThrow();
  });

  it('handles rapid concurrent events safely', async () => {
    const logger = new AuditLogger(tmpDir);
    const runId = 'concurrent-run';
    
    const count = 100;
    const promises = Array.from({ length: count }).map((_, i) => {
      return new Promise<void>((resolve) => {
        logger.logEvent(runId, 'rapid_event', { index: i });
        resolve();
      });
    });
    
    await Promise.all(promises);
    
    const auditFile = path.join(tmpDir, '.mini-agent', 'audit.jsonl');
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    expect(lines.length).toBe(count);
    expect(lines.every(line => {
      const record = JSON.parse(line);
      return record.runId === runId && record.event === 'rapid_event' && record.index !== undefined;
    })).toBe(true);
  });
});
