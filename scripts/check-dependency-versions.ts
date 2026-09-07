import fs from 'node:fs/promises';
import path from 'node:path';

export function checkDependencyVersions(pkg: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const dependencySections = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ];

  for (const section of dependencySections) {
    const deps = pkg[section];
    if (!deps || typeof deps !== 'object') continue;

    for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof version !== 'string') continue;

      if (version.includes('^') || version.includes('~')) {
        errors.push(
          `Dependency "${name}" in "${section}" has non-exact version "${version}" (contains '^' or '~').`,
        );
      } else if (/^[><=*xX]/.test(version) || version.includes('||')) {
        errors.push(
          `Dependency "${name}" in "${section}" has non-exact version "${version}".`,
        );
      }
    }
  }

  return errors;
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('check-dependency-versions.ts') ||
    path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname));

if (isMain) {
  const packagePath = path.resolve(process.cwd(), 'package.json');
  const raw = await fs.readFile(packagePath, 'utf8');
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const errors = checkDependencyVersions(pkg);

  if (errors.length > 0) {
    console.error('Dependency version check failed:');
    for (const err of errors) {
      console.error(` - ${err}`);
    }
    process.exit(1);
  }

  console.log('Dependency version check passed: all dependencies use exact versions.');
}
