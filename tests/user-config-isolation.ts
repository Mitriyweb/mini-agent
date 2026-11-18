import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'bun:test';

/**
 * Point XDG_CONFIG_HOME at a fresh temp dir for every test in the current file.
 * Keeps a developer's real ~/.config/mini-agent config out of assertions that
 * expect built-in defaults.
 */
export const isolateUserConfig = (): void => {
  let home: string | undefined;
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.XDG_CONFIG_HOME;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-user-config-'));
    process.env.XDG_CONFIG_HOME = home;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previous;
    if (home) fs.rmSync(home, { recursive: true, force: true });
    home = undefined;
  });
};
