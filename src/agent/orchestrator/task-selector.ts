import type { PlannedTask } from './task-planner.ts';

/**
 * Checks if all declared dependencies for a task are completed.
 * Dependencies are matched against task IDs or task indices.
 */
export const areDependenciesSatisfied = (
  task: PlannedTask,
  allTasks: PlannedTask[],
): boolean => {
  if (!task.dependencies || task.dependencies.length === 0) {
    return true;
  }

  const completedIds = new Set(
    allTasks.filter((t) => t.completed).map((t) => t.id),
  );

  return task.dependencies.every((dep) => completedIds.has(dep));
};

/**
 * Selects the next eligible incomplete task whose dependencies have been satisfied.
 * If no explicit dependencies are defined, respects the original order.
 * Returns null if all tasks are complete or no incomplete task has satisfied dependencies.
 */
export interface PlanDiagnostic {
  blocked: boolean;
  reason?: string;
  circularDependency?: string[];
  missingDependencies?: { taskId: string; missing: string[] }[];
}

/**
 * Validates dependencies across all tasks in the plan.
 * Detects missing dependency IDs and circular dependencies.
 */
export const diagnosePlan = (tasks: PlannedTask[]): PlanDiagnostic => {
  const taskMap = new Map<string, PlannedTask>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  // Check for missing dependency IDs
  const missingDependencies: { taskId: string; missing: string[] }[] = [];
  for (const task of tasks) {
    const missing = task.dependencies.filter((dep) => !taskMap.has(dep));
    if (missing.length > 0) {
      missingDependencies.push({ taskId: task.id, missing });
    }
  }

  if (missingDependencies.length > 0) {
    const lines = missingDependencies.map(
      (m) => `Task ${m.taskId} depends on non-existent task(s): ${m.missing.join(', ')}`,
    );
    return {
      blocked: true,
      reason: `Missing dependency references detected:\n${lines.join('\n')}`,
      missingDependencies,
    };
  }

  // Detect circular dependencies among incomplete tasks
  const incompleteTasks = tasks.filter((t) => !t.completed);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cycle: string[] | undefined;

  const dfs = (taskId: string, path: string[]): boolean => {
    visiting.add(taskId);
    path.push(taskId);

    const task = taskMap.get(taskId);
    if (task) {
      for (const depId of task.dependencies) {
        const depTask = taskMap.get(depId);
        if (depTask && !depTask.completed) {
          if (visiting.has(depId)) {
            const cycleStart = path.indexOf(depId);
            cycle = path.slice(cycleStart).concat(depId);
            return true;
          }
          if (!visited.has(depId)) {
            if (dfs(depId, path)) return true;
          }
        }
      }
    }

    path.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return false;
  };

  for (const task of incompleteTasks) {
    if (!visited.has(task.id)) {
      if (dfs(task.id, [])) {
        break;
      }
    }
  }

  const foundCycle: string[] | undefined = cycle;
  if (foundCycle) {
    return {
      blocked: true,
      reason: `Circular dependency detected: ${foundCycle.join(' -> ')}`,
      circularDependency: foundCycle,
    };
  }

  return { blocked: false };
};

/**
 * Selects the next eligible incomplete task whose dependencies have been satisfied.
 * If no explicit dependencies are defined, respects the original order.
 * Returns null if all tasks are complete or no incomplete task has satisfied dependencies.
 */
export const selectNextTask = (
  tasks: PlannedTask[],
): PlannedTask | null => {
  for (const task of tasks) {
    if (!task.completed && areDependenciesSatisfied(task, tasks)) {
      return task;
    }
  }
  return null;
};
