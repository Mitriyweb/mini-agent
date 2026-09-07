import { describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkDependencyVersions } from '../scripts/check-dependency-versions.ts';

describe('Dependency version validation test suite', () => {
  it('package.json dependencies and devDependencies contain only exact versions', async () => {
    const packagePath = path.resolve(process.cwd(), 'package.json');
    const raw = await fs.readFile(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    const errors = checkDependencyVersions(pkg);

    expect(errors).toEqual([]);
  });

  it('checkDependencyVersions detects ^ and ~ in dependencies', () => {
    const testPkg = {
      dependencies: {
        pkgA: '^1.0.0',
        pkgB: '~2.1.0',
        pkgC: '3.0.0',
      },
      devDependencies: {
        pkgD: '^0.5.0',
      },
    };

    const errors = checkDependencyVersions(testPkg);
    expect(errors.length).toBe(3);
    expect(errors[0]).toContain('pkgA');
    expect(errors[0]).toContain('^1.0.0');
    expect(errors[1]).toContain('pkgB');
    expect(errors[1]).toContain('~2.1.0');
    expect(errors[2]).toContain('pkgD');
    expect(errors[2]).toContain('^0.5.0');
  });

  it('checkDependencyVersions returns no errors when all versions are exact', () => {
    const testPkg = {
      dependencies: {
        pkgA: '1.0.0',
      },
      devDependencies: {
        pkgB: '2.1.0',
      },
    };

    const errors = checkDependencyVersions(testPkg);
    expect(errors).toEqual([]);
  });
});
