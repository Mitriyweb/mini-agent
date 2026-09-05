import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface FrontmatterResult {
  metadata: Record<string, string>;
  body: string;
}

export interface Workflow {
  name: string;
  command: string;
  description: string;
  path: string;
  content: string;
  raw: string;
}

export interface Skill {
  name: string;
  description: string;
  dir: string;
  path: string;
  content: string;
  raw: string;
}

export interface WorkflowResolveResult {
  matched: true;
  workflow: Workflow;
  extraArgs: string;
  prompt: string;
}

export interface WorkflowNoMatch {
  matched: false;
  commandName: string;
  extraArgs: string;
}

export const parseFrontmatter = (content: string): FrontmatterResult => {
  if (typeof content !== 'string') return { metadata: {}, body: '' };
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { metadata: {}, body: content.trim() };
  const rawYaml = match[1];
  const body = match[2].trim();
  const metadata: Record<string, string> = {};
  const lines = rawYaml.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      let value = trimmed.slice(colonIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      metadata[key] = value;
    }
  }
  return { metadata, body };
};

const safeReadDir = async (dirPath: string): Promise<import('node:fs').Dirent[]> => {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
};

const safeReadFile = async (filePath: string): Promise<string | null> => {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
};

const getCustomizationRoots = (workspaceRoot?: string): string[] => {
  const roots: string[] = [];
  if (workspaceRoot) roots.push(path.resolve(workspaceRoot));
  const homeDir = os.homedir();
  if (homeDir && !roots.includes(homeDir)) roots.push(homeDir);
  return roots;
};

export const loadWorkflows = async (workspaceRoot?: string): Promise<Workflow[]> => {
  const roots = getCustomizationRoots(workspaceRoot);
  const workflows = new Map<string, Workflow>();

  for (const root of roots) {
    const candidates = [path.join(root, '.agents', 'workflows'), path.join(root, 'workflows')];

    for (const dir of candidates) {
      const entries = await safeReadDir(dir);
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const name = path.basename(entry.name, '.md');
          if (workflows.has(name)) continue; // workspace takes precedence over global

          const filePath = path.join(dir, entry.name);
          const raw = await safeReadFile(filePath);
          if (!raw) continue;

          const { metadata, body } = parseFrontmatter(raw);
          workflows.set(name, {
            name,
            command: `/${name}`,
            description: metadata['description'] || name,
            path: filePath,
            content: body,
            raw,
          });
        }
      }
    }
  }

  return Array.from(workflows.values());
};

export const loadSkills = async (workspaceRoot?: string): Promise<Skill[]> => {
  const roots = getCustomizationRoots(workspaceRoot);
  const skills = new Map<string, Skill>();

  for (const root of roots) {
    const candidates = [path.join(root, '.agents', 'skills'), path.join(root, 'skills')];

    for (const dir of candidates) {
      const entries = await safeReadDir(dir);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillName = entry.name;
          if (skills.has(skillName)) continue; // workspace takes precedence over global

          const skillDir = path.join(dir, skillName);
          const skillFile = path.join(skillDir, 'SKILL.md');
          const raw = await safeReadFile(skillFile);
          if (!raw) continue;

          const { metadata, body } = parseFrontmatter(raw);
          const name = metadata['name'] || skillName;
          skills.set(name, {
            name,
            description: metadata['description'] || '',
            dir: skillDir,
            path: skillFile,
            content: body,
            raw,
          });
        }
      }
    }
  }

  return Array.from(skills.values());
};

export const formatCustomizationsPrompt = ({
  workflows = [],
  skills = [],
}: {
  workflows?: Workflow[];
  skills?: Skill[];
}): string => {
  const sections: string[] = [];

  if (workflows.length > 0) {
    const workflowLines = workflows.map((wf) => `- /${wf.name} (${wf.path}): ${wf.description}`);
    sections.push(
      `## Workflows\nWorkflows are markdown-based guides providing step-by-step instructions for specific tasks.\nAvailable workflows:\n${workflowLines.join('\n')}`,
    );
  }

  if (skills.length > 0) {
    const skillLines = skills.map((s) => `- ${s.name} (${s.path}): ${s.description}`);
    sections.push(
      `## Skills\nSkills are specialized instruction sets that extend your capabilities.\nAvailable skills:\n${skillLines.join('\n')}\n\nWhen a skill is relevant to the task, read its SKILL.md file using the read tool before proceeding.`,
    );
  }

  if (sections.length === 0) return '';
  return `\n\n# Customizations\n\n${sections.join('\n\n')}`;
};

export const resolveWorkflowCommand = (
  input: string,
  workflows: Workflow[] = [],
): WorkflowResolveResult | WorkflowNoMatch | null => {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;

  const commandName = match[1];
  const extraArgs = match[2]?.trim() || '';

  const workflow = workflows.find((wf) => wf.name.toLowerCase() === commandName.toLowerCase());
  if (!workflow) {
    return { matched: false, commandName, extraArgs };
  }

  const prompt = extraArgs ? `${workflow.content}\n\n---\nUser context/input: ${extraArgs}` : workflow.content;

  return { matched: true, workflow, extraArgs, prompt };
};
