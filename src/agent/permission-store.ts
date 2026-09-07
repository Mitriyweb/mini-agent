import fs from 'node:fs';
import path from 'node:path';
import type { PermissionConfig, PermissionRule } from '../types/permissions.js';

export class PermissionStore {
  readonly configPath: string;

  constructor(configPath: string) {
    this.configPath = configPath;
  }

  load(): PermissionConfig {
    if (!fs.existsSync(this.configPath)) {
      return { version: 1, rules: [] };
    }

    try {
      const content = fs.readFileSync(this.configPath, 'utf8');
      const parsed = JSON.parse(content);

      if (!parsed || typeof parsed !== 'object') {
        console.warn(`[PermissionStore] Invalid permissions config format in ${this.configPath}. Resetting to default.`);
        return { version: 1, rules: [] };
      }

      if (parsed.version !== 1) {
        console.warn(`[PermissionStore] Unsupported permissions config version ${parsed.version} in ${this.configPath}. Expected version 1.`);
        return { version: 1, rules: [] };
      }

      const rawRules = Array.isArray(parsed.rules) ? parsed.rules : [];

      const rules: PermissionRule[] = rawRules
        .filter((r: any) => {
          if (!r || typeof r !== 'object') return false;
          if (typeof r.pattern !== 'string' || r.pattern.trim().length === 0) return false;
          if (r.effect !== 'allow' && r.effect !== 'deny') return false;
          if (r.match !== 'exact' && r.match !== 'glob') return false;
          return true;
        })
        .map((r: any) => ({
          id: r.id ?? undefined,
          effect: r.effect,
          pattern: r.pattern,
          match: r.match,
          scope: 'persistent',
          createdAt: typeof r.createdAt === 'number' ? r.createdAt : undefined,
        }));

      return { version: 1, rules };
    } catch (err) {
      console.warn(`[PermissionStore] Failed to parse permissions config from ${this.configPath}: ${err}. Returning empty config.`);
      return { version: 1, rules: [] };
    }
  }

  save(config: PermissionConfig): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Save only persistent rules
    const persistentRules = config.rules
      .filter((r) => r.scope !== 'session')
      .map((r) => {
        const item: Record<string, any> = {
          effect: r.effect,
          pattern: r.pattern,
          match: r.match,
        };
        if (r.id) item.id = r.id;
        if (r.createdAt) item.createdAt = r.createdAt;
        return item;
      });

    const output = JSON.stringify({ version: 1, rules: persistentRules }, null, 2) + '\n';
    const tmpPath = `${this.configPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2)}`;

    try {
      fs.writeFileSync(tmpPath, output, 'utf8');
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      if (fs.existsSync(tmpPath)) {
        try { fs.unlinkSync(tmpPath); } catch {}
      }
      throw err;
    }
  }

  addRule(rule: PermissionRule): PermissionConfig {
    const config = this.load();
    const newRule: PermissionRule = {
      ...rule,
      scope: 'persistent',
      createdAt: rule.createdAt ?? Date.now(),
    };

    // Avoid duplicate rule
    const exists = config.rules.some(
      (r) => r.effect === newRule.effect && r.pattern === newRule.pattern && r.match === newRule.match
    );

    if (!exists) {
      config.rules.push(newRule);
      this.save(config);
    }

    return config;
  }
}
