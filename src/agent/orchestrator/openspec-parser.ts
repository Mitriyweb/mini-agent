import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface OpenSpecTask {
  id: string;
  rawText: string;
  description: string;
  completed: boolean;
  section?: string;
  dependencies: string[];
  specs: string[];
  lineNumber: number;
}

export interface OpenSpecChangeContext {
  changeName: string;
  changeDir: string;
  tasksFilePath: string;
  tasks: OpenSpecTask[];
  proposal?: string;
  design?: string;
  specs: Record<string, string>;
  otherFiles: Record<string, string>;
}

/**
 * Parses markdown tasks from tasks.md content.
 * Follows OpenSpec checkbox format:
 * - [ ] or - [ ] 1.1 Description
 * - [x] or - [X] or - [ x] counts as completed
 * Parent headers (e.g. ## 1. Setup) are captured as sections.
 * Dependencies can be explicitly declared via:
 *   [depends on: 1.1, 1.2] or [depends: 1.1] or (deps: 1.1)
 * Relevant spec references can be declared via:
 *   [spec: auth] or [specs: auth, users]
 */
export const parseTasksMarkdown = (content: string): OpenSpecTask[] => {
  const lines = content.split('\n');
  const tasks: OpenSpecTask[] = [];
  const seenIds = new Set<string>();
  let currentSection: string | undefined;
  let autoIdCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track section headings (## Heading)
    const headingMatch = trimmed.match(/^#{2,6}\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    // Match checkbox list item: - [ ] or - [x] or * [ ] or - [~]
    // A box holding only x or X (with any spaces) counts as done
    const taskMatch = line.match(/^(\s*[-*]\s*\[)([^\]]*?)(\]\s*)(.+)$/);
    if (taskMatch) {
      const checkInside = taskMatch[2].trim();
      const completed = checkInside.toLowerCase() === 'x';
      const fullDescription = taskMatch[4].trim();

      // Check if task starts with an explicit identifier, e.g. "1.1 Task desc" or "TASK-1: desc"
      let taskId = '';
      let desc = fullDescription;

      const numHierarchicalMatch = fullDescription.match(/^(\d+(?:\.\d+)*)(?:\s+|[:.]\s+)(.+)$/);
      if (numHierarchicalMatch) {
        taskId = numHierarchicalMatch[1];
        desc = numHierarchicalMatch[2].trim();
      } else {
        const idMatch = fullDescription.match(/^([a-zA-Z0-9_.-]*\d[a-zA-Z0-9_.-]*)[:.]\s+(.+)$/);
        if (idMatch) {
          taskId = idMatch[1];
          desc = idMatch[2].trim();
        } else {
          taskId = `task-${autoIdCounter++}`;
        }
      }

      // Check for explicit dependencies: [depends on: ...] or (depends: ...) or [deps: ...]
      const dependencies: string[] = [];
      const depMatch = desc.match(/[\[\(](?:depends(?:\s+on)?|deps)[:\s]+([^\]\)]+)[\]\)]/i);
      if (depMatch) {
        const rawDeps = depMatch[1];
        const parsedDeps = rawDeps
          .split(/[,;\s]+/)
          .map((d) => d.trim())
          .filter(Boolean);
        dependencies.push(...parsedDeps);
      }

      // Check for explicit spec references: [spec: ...] or [specs: ...]
      const specs: string[] = [];
      const specMatch = desc.match(/[\[\(]specs?[:\s]+([^\]\)]+)[\]\)]/i);
      if (specMatch) {
        const rawSpecs = specMatch[1];
        const parsedSpecs = rawSpecs
          .split(/[,;\s]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        specs.push(...parsedSpecs);
      }

      if (seenIds.has(taskId)) {
        throw new Error(`Duplicate task ID '${taskId}' found at line ${i + 1}. Task IDs must be unique.`);
      }
      seenIds.add(taskId);

      tasks.push({
        id: taskId,
        rawText: line,
        description: desc,
        completed,
        section: currentSection,
        dependencies,
        specs,
        lineNumber: i + 1,
      });
    }
  }

  return tasks;
};

/**
 * Updates a specific task's completion checkbox in tasks.md without disturbing
 * formatting, comments, or any other tasks.
 */
export const updateTaskInMarkdown = (
  content: string,
  taskId: string,
  completed: boolean,
): { updatedContent: string; found: boolean } => {
  const lines = content.split('\n');
  let currentSection: string | undefined;
  let autoIdCounter = 1;
  let targetIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const headingMatch = trimmed.match(/^#{2,6}\s+(.+)$/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }

    const taskMatch = line.match(/^(\s*[-*]\s*\[)([^\]]*?)(\]\s*)(.+)$/);
    if (taskMatch) {
      const fullDescription = taskMatch[4].trim();
      let currentId = '';
      const numHierarchicalMatch = fullDescription.match(/^(\d+(?:\.\d+)*)(?:\s+|[:.]\s+)(.+)$/);
      if (numHierarchicalMatch) {
        currentId = numHierarchicalMatch[1];
      } else {
        const idMatch = fullDescription.match(/^([a-zA-Z0-9_.-]*\d[a-zA-Z0-9_.-]*)[:.]\s+(.+)$/);
        if (idMatch) {
          currentId = idMatch[1];
        } else {
          currentId = `task-${autoIdCounter++}`;
        }
      }

      if (currentId === taskId) {
        targetIndex = i;
        const mark = completed ? 'x' : ' ';
        lines[i] = `${taskMatch[1]}${mark}${taskMatch[3]}${taskMatch[4]}`;
        break;
      }
    }
  }

  return {
    updatedContent: lines.join('\n'),
    found: targetIndex !== -1,
  };
};

/**
 * Finds the OpenSpec root directory in the workspace.
 * Defaults to `openspec` in workspaceRoot.
 */
export const resolveOpenSpecDir = (workspaceRoot: string): string => {
  return path.join(workspaceRoot, 'openspec');
};

/**
 * Resolves the directory for a given change name.
 */
export const resolveChangeDir = (workspaceRoot: string, changeName: string): string => {
  if (
    !changeName ||
    typeof changeName !== 'string' ||
    !changeName.trim() ||
    changeName !== path.basename(changeName) ||
    changeName === '.' ||
    changeName === '..'
  ) {
    throw new Error('Invalid OpenSpec change name.');
  }

  const openSpecDir = resolveOpenSpecDir(workspaceRoot);
  const changesDir = path.resolve(openSpecDir, 'changes');
  const changeDir = path.resolve(changesDir, changeName.trim());

  if (path.dirname(changeDir) !== changesDir) {
    throw new Error('OpenSpec change path escapes changes directory.');
  }

  // If changeDir exists, resolve realpath to ensure symlinks don't escape
  if (fs.existsSync(changeDir)) {
    const realChangesDir = fs.existsSync(changesDir) ? fs.realpathSync(changesDir) : changesDir;
    const realChangeDir = fs.realpathSync(changeDir);
    const relative = path.relative(realChangesDir, realChangeDir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('OpenSpec change symlink escapes changes directory.');
    }
  }

  return changeDir;
};

/**
 * Loads and parses an entire OpenSpec change from the workspace.
 */
export const loadOpenSpecChange = async (
  workspaceRoot: string,
  changeName: string,
): Promise<OpenSpecChangeContext> => {
  if (!changeName || !changeName.trim()) {
    throw new Error('Change name must not be empty.');
  }

  const changeDir = resolveChangeDir(workspaceRoot, changeName);
  if (!fs.existsSync(changeDir) || !fs.statSync(changeDir).isDirectory()) {
    throw new Error(`OpenSpec change directory not found: ${changeDir}`);
  }

  const tasksFilePath = path.join(changeDir, 'tasks.md');
  if (!fs.existsSync(tasksFilePath)) {
    throw new Error(`OpenSpec tasks file not found: ${tasksFilePath}`);
  }

  // Ensure tasks.md realpath does not escape realChangeDir via symlinks
  const realChangeDir = fs.realpathSync(changeDir);
  const realTasksFilePath = fs.realpathSync(tasksFilePath);
  const relTasks = path.relative(realChangeDir, realTasksFilePath);
  if (relTasks.startsWith('..') || path.isAbsolute(relTasks)) {
    throw new Error('OpenSpec tasks file symlink escapes change directory.');
  }

  const tasksContent = await fs.promises.readFile(tasksFilePath, 'utf8');
  const tasks = parseTasksMarkdown(tasksContent);

  // Proposal
  let proposal: string | undefined;
  const proposalPath = path.join(changeDir, 'proposal.md');
  if (fs.existsSync(proposalPath)) {
    proposal = await fs.promises.readFile(proposalPath, 'utf8');
  }

  // Design
  let design: string | undefined;
  const designPath = path.join(changeDir, 'design.md');
  if (fs.existsSync(designPath)) {
    design = await fs.promises.readFile(designPath, 'utf8');
  }

  // Specs under changeDir/specs/ and global openspec/specs/
  const specs: Record<string, string> = {};

  const loadSpecsFromDir = async (dir: string, prefix = '') => {
    if (!fs.existsSync(dir)) return;
    const realDir = fs.realpathSync(dir);
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await loadSpecsFromDir(fullPath, relative);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.yaml') || entry.name.endsWith('.json'))) {
        try {
          const realFile = fs.realpathSync(fullPath);
          const rel = path.relative(realDir, realFile);
          if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
          specs[relative] = await fs.promises.readFile(fullPath, 'utf8');
        } catch {
          // ignore unreadable files
        }
      }
    }
  };

  const changeSpecsDir = path.join(changeDir, 'specs');
  await loadSpecsFromDir(changeSpecsDir, 'change');

  const rootSpecsDir = path.join(resolveOpenSpecDir(workspaceRoot), 'specs');
  await loadSpecsFromDir(rootSpecsDir, 'global');

  // Other contextual files in changeDir (like .openspec.yaml or notes)
  const otherFiles: Record<string, string> = {};
  const rootChangeFiles = await fs.promises.readdir(changeDir, { withFileTypes: true });
  for (const entry of rootChangeFiles) {
    if (
      entry.isFile() &&
      entry.name !== 'tasks.md' &&
      entry.name !== 'proposal.md' &&
      entry.name !== 'design.md'
    ) {
      try {
        const fullPath = path.join(changeDir, entry.name);
        const realFile = fs.realpathSync(fullPath);
        const rel = path.relative(realChangeDir, realFile);
        if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
        otherFiles[entry.name] = await fs.promises.readFile(fullPath, 'utf8');
      } catch {
        // ignore
      }
    }
  }

  return {
    changeName,
    changeDir,
    tasksFilePath,
    tasks,
    proposal,
    design,
    specs,
    otherFiles,
  };
};

/**
 * Writes the updated task status into tasks.md atomically.
 */
export const markTaskCompleteInFile = async (
  tasksFilePath: string,
  taskId: string,
  completed = true,
): Promise<void> => {
  const content = await fs.promises.readFile(tasksFilePath, 'utf8');
  const { updatedContent, found } = updateTaskInMarkdown(content, taskId, completed);
  if (!found) {
    throw new Error(`Task '${taskId}' not found in ${tasksFilePath}`);
  }
  const tempPath = `${tasksFilePath}.${randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tempPath, updatedContent, 'utf8');
    await fs.promises.rename(tempPath, tasksFilePath);
  } finally {
    try {
      if (fs.existsSync(tempPath)) {
        await fs.promises.unlink(tempPath);
      }
    } catch {
      // Ignore cleanup error if already renamed
    }
  }
};
