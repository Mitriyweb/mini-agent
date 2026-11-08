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
