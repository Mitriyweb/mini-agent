import type { OpenSpecChangeContext } from './openspec-parser.ts';
import type { PlannedTask } from './task-planner.ts';

export interface TaskPromptOptions {
  changeContext: OpenSpecChangeContext;
  currentTask: PlannedTask;
  allTasks: PlannedTask[];
  attempt?: number;
  maxAttempts?: number;
  lastError?: string;
  gateFailures?: string;
}

/**
 * Builds a focused prompt context for the LLM to execute a specific task.
 * Avoids needlessly sending entire large repos.
 * Gives the model:
 * - Overall OpenSpec objective
 * - Current task and its identifier
 * - Full task list for progress awareness
 * - Relevant specification requirements
 * - Relevant design decisions
 * - Relevant source files / references
 * - Previously completed tasks
 * - Constraints and coding conventions
 * - Error/retry context if this is a correction attempt
 */
export const buildTaskPrompt = (options: TaskPromptOptions): string => {
  const {
    changeContext,
    currentTask,
    allTasks,
    attempt = 1,
    maxAttempts = 3,
    lastError,
    gateFailures,
  } = options;

  const sections: string[] = [];

  // 1. Header & Current Task Target
  sections.push(
    `# OpenSpec Change Execution: ${changeContext.changeName}\n\n` +
    `You are implementing a specific task as part of the OpenSpec change "${changeContext.changeName}".\n` +
    `Focus ONLY on implementing the current task. Do not jump ahead to future tasks.\n\n` +
    `## Current Task to Implement\n` +
    `- **Task ID:** ${currentTask.id}\n` +
    `- **Progress:** Task ${currentTask.index} of ${currentTask.total}\n` +
    (currentTask.section ? `- **Section:** ${currentTask.section}\n` : '') +
    `- **Description:** ${currentTask.description}\n`,
  );

  // 2. Retry / Error Feedback (if applicable)
  if (attempt > 1 && (lastError || gateFailures)) {
    sections.push(
      `## ⚠️ Previous Attempt Failed (Attempt ${attempt}/${maxAttempts})\n` +
      `The previous attempt did not pass validation. Please inspect and fix the issues below:\n\n` +
      (lastError ? `### Execution Error:\n\`\`\`\n${lastError}\n\`\`\`\n\n` : '') +
      (gateFailures ? `### Quality Gate / Validation Failures:\n\`\`\`\n${gateFailures}\n\`\`\`\n` : ''),
    );
  }

  // 3. Overall Objective / Proposal Summary
  if (changeContext.proposal) {
    sections.push(
      `## Overall Change Objective\n${changeContext.proposal.trim()}\n`,
    );
  }

  // 4. Design Decisions (if available)
  if (changeContext.design) {
    sections.push(
      `## Technical Design & Architecture\n${changeContext.design.trim()}\n`,
    );
  }

  // 5. Relevant Specifications
  const relevantSpecs: string[] = [];
  if (currentTask.specs && currentTask.specs.length > 0) {
    for (const [specName, specContent] of Object.entries(changeContext.specs)) {
      if (currentTask.specs.some((s) => specName.toLowerCase().includes(s.toLowerCase()))) {
        relevantSpecs.push(`### Spec: ${specName}\n${specContent.trim()}`);
      }
    }
  }

  // If no specific match, include change specs if any exist
  if (relevantSpecs.length === 0) {
    for (const [specName, specContent] of Object.entries(changeContext.specs)) {
      if (specName.startsWith('change/')) {
        relevantSpecs.push(`### Spec: ${specName}\n${specContent.trim()}`);
      }
    }
  }

  if (relevantSpecs.length > 0) {
    sections.push(
      `## Relevant Specifications\n${relevantSpecs.join('\n\n')}\n`,
    );
  }

  // 6. Full Task Checklist for Context & Progress Awareness
  const checklistLines = allTasks.map((t) => {
    const mark = t.completed ? 'x' : t.id === currentTask.id ? ' ' : ' ';
    const currentIndicator = t.id === currentTask.id ? ' <-- [CURRENT TASK]' : '';
    return `- [${mark}] ${t.id}: ${t.description}${currentIndicator}`;
  });

  sections.push(
    `## Change Task Checklist\n${checklistLines.join('\n')}\n`,
  );

  // 7. General Instructions and Constraints
  sections.push(
    `## Implementation Constraints\n` +
    `- Implement the current task accurately and completely.\n` +
    `- Verify your changes (e.g. run tests or checks if applicable).\n` +
    `- Do NOT mark the task complete in tasks.md manually; the orchestrator handles updating tasks.md after quality gates pass.\n` +
    `- Keep code changes minimal, correct, and well-structured.\n`,
  );

  return sections.join('\n');
};
