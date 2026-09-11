import { TrustKind, type Tool, type ToolDefinition, type ToolEnvironment } from '../types/tools.js';
import { readTextFile } from '../utils/textfile.js';
import { globToRegExp } from '../utils/globmatch.js';

export interface OpenspecArgs {
  path: string;
  operation?: 'info' | 'paths' | 'operations' | 'validate';
  path_filter?: string; // If operation is 'operations', filter by path pattern
}

export const openspecDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'openspec',
    description: 'Read and work with openspec (OpenAPI-style) specification files. Supports reading, validating, and extracting information from openspec JSON/YAML files.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the openspec file within the workspace.',
        },
        operation: {
          type: 'string',
          description: 'Operation type: "info" to show spec metadata, "paths" to list all paths, "operations" to list operations with details, "validate" to validate the spec structure.',
        },
        path_filter: {
          type: 'string',
          description: 'Filter for "operations" operation - API path or pattern (e.g., "/users" or "/users/*").',
        },
      },
      required: ['path'],
    },
  },
};

type OpenspecInfo = {
  title?: string;
  version?: string;
  description?: string;
  openapi?: string;
};

type OpenspecOperation = {
  summary?: string;
  description?: string;
  parameters?: unknown[];
  requestBody?: unknown;
  responses?: unknown;
};

type OpenspecPath = Record<string, OpenspecOperation>;

const isOpenspecInfo = (data: unknown): data is OpenspecInfo =>
  data !== null && typeof data === 'object' && (data as Record<string, unknown>).openapi !== undefined;

const isOpenspecPaths = (data: unknown): data is Record<string, OpenspecPath> =>
  data !== null && typeof data === 'object' && typeof (data as Record<string, unknown>).paths === 'object';

export const createOpenspecTool = (env: ToolEnvironment): Tool<OpenspecArgs, string> => {
  const { workspace } = env;
  return {
    needsApproval: false,
    trust: TrustKind.PATH,
    describe(args) {
      return `openspec ${args.path}`;
    },
    async execute(args) {
      const relativePath = args.path;
      const filePath = await workspace.resolveExistingFile(relativePath);
      const content = await readTextFile(filePath);

      let parsedData: unknown;

      try {
        parsedData = JSON.parse(content);
      } catch {
        parsedData = parseYamlSimple(content);
      }

      const operation = args.operation ?? 'info';

      switch (operation) {
        case 'info':
          return getOpenspecInfo(parsedData);
        case 'paths':
          return getOpenspecPaths(parsedData);
        case 'operations':
          return getOpenspecOperations(parsedData, args.path_filter);
        case 'validate':
          return validateOpenspec(parsedData);
        default:
          return `Unknown operation "${operation}". Supported operations: "info", "paths", "operations", "validate".`;
      }
    },
    definition: openspecDefinition,
  };
};

function parseYamlSimple(content: string): unknown {
  const lines = content.split('\n');
  const obj: Record<string, any> = {};
  let currentKey = '';
  let inInfo = false;
  let inPaths = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const leadingSpaces = line.length - line.trimStart().length;

    if (leadingSpaces === 0) {
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        currentKey = key;
        inInfo = key === 'info';
        inPaths = key === 'paths';
        if (val) {
          obj[key] = val.replace(/^['"]|['"]$/g, '');
        } else {
          obj[key] = {};
        }
      }
    } else if (inInfo && leadingSpaces >= 2) {
      if (!obj.info || typeof obj.info !== 'object') obj.info = {};
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        obj.info[key] = val;
      }
    } else if (inPaths && leadingSpaces >= 2) {
      if (!obj.paths || typeof obj.paths !== 'object') obj.paths = {};
      const keyMatch = trimmed.match(/^(['"]?)([^:'"]+)\1\s*:/);
      if (keyMatch) {
        const pKey = keyMatch[2];
        if (!obj.paths[pKey]) obj.paths[pKey] = {};
      }
    }
  }

  return obj;
}

const getOpenspecInfo = (data: unknown): string => {
  let result = '📊 Openspec Information:\n';

  if (isOpenspecInfo(data)) {
    const info = (data as Record<string, unknown>).info as Record<string, unknown> | undefined;
    const title = typeof info?.title === 'string' ? info.title : 'N/A';
    const version = typeof info?.version === 'string' ? info.version : 'N/A';
    const description = typeof info?.description === 'string' ? info.description : 'N/A';
    const openapi = typeof (data as Record<string, unknown>).openapi === 'string' ? (data as Record<string, unknown>).openapi : 'N/A';

    result += `\n  Title: ${title}\n`;
    result += `  Version: ${version}\n`;
    result += `  OpenAPI Version: ${openapi}\n`;
    result += `  Description: ${description}`;
  } else {
    result += '\n  ⚠️  File is not in valid OpenAPI format (missing "openapi" field)';
  }

  return result;
};

const getOpenspecPaths = (data: unknown): string => {
  let result = '📍 Available Paths:\n';

  if (isOpenspecPaths(data)) {
    const paths = Object.keys(data.paths || {});
    if (paths.length === 0) {
      return '  No paths found in the openspec.\n';
    }
    paths.forEach((p) => {
      result += `  - ${p}\n`;
    });
  } else {
    result += '\n  ⚠️  File is not in valid OpenAPI format (missing "paths" field)';
  }

  return result;
};

const getOpenspecOperations = (data: unknown, pathFilter?: string): string => {
  let result = '🎯 Operations:\n';

  if (!isOpenspecPaths(data)) {
    return '\n  ⚠️  File is not in valid OpenAPI format (missing "paths" field)\n';
  }

  const paths = data.paths || {};
  let matchCount = 0;

  let pathKeys: string[];
  if (pathFilter) {
    pathKeys = Object.keys(paths)
      .filter((p) => (pathFilter.includes('*') || pathFilter.includes('?') ? globToRegExp(pathFilter).test(p) : p === pathFilter))
      .sort();
    if (pathKeys.length === 0) {
      return `  No paths match filter "${pathFilter}".\n`;
    }
  } else {
    pathKeys = Object.keys(paths).sort();
  }

  for (const path of pathKeys) {
    const methods = paths[path] as Record<string, OpenspecOperation>;
    const methodNames = Object.keys(methods).filter((k) => k !== 'x-middleware').sort();

    if (methodNames.length === 0) {
      result += `\n  GET ${path}\n    Summary: Operation\n`;
      matchCount++;
      continue;
    }

    matchCount += methodNames.length;

    for (const method of methodNames) {
      const op = methods[method] ?? {};
      const summary = op.summary || op.description || 'No description';
      result += `\n  ${method.toUpperCase()} ${path}\n`;
      result += `    Summary: ${summary.substring(0, 100)}${summary.length > 100 ? '...' : ''}\n`;
    }
  }

  return matchCount > 0 ? result : '  No operations found.\n';
};

const validateOpenspec = (data: unknown): string => {
  if (!data || typeof data !== 'object') {
    return '⚠️  The file contains invalid content. Expected a JSON/YAML object.\n';
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const hasOpenapi = 'openapi' in (data as Record<string, unknown>);
  const hasInfo = 'info' in (data as Record<string, unknown>);
  const hasPaths = 'paths' in (data as Record<string, unknown>);

  if (!hasOpenapi) {
    errors.push('  ❌ Missing required field: "openapi" (e.g., "3.0.0")');
  }

  if (!hasInfo) {
    warnings.push('  ⚠️  Missing recommended field: "info" (general specification information)');
  } else {
    const info = (data as Record<string, unknown>).info as Record<string, unknown> | undefined;
    if (info) {
      if (!info.title) warnings.push('  ⚠️  Info.title is typically recommended');
      if (!info.version) warnings.push('  ⚠️  Info.version is required if Info object exists');
    }
  }

  if (!hasPaths) {
    errors.push('  ❌ Missing required field: "paths" (endpoint definitions)');
  } else {
    const paths = (data as Record<string, unknown>).paths;
    if (typeof paths !== 'object' || paths === null) {
      errors.push('  ❌ Paths field must be an object');
    } else {
      const pathCount = Object.keys(paths).length;
      if (pathCount === 0) {
        warnings.push('  ⚠️  Paths object is empty');
      }
    }
  }

  let result = '🔍 Openspec Validation:\n\n';

  if (errors.length === 0 && warnings.length === 0) {
    result += '  ✅ No critical or warning issues found.\n';
  } else {
    if (errors.length > 0) {
      result += '\n  Errors:\n' + errors.join('') + '\n';
    }
    if (warnings.length > 0) {
      result += '\n  Warnings:\n' + warnings.join('') + '\n';
    }
  }

  return result;
};
