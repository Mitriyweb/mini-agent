import type { OpenSpecTask } from './openspec-parser.ts';

export interface PlannedTask extends OpenSpecTask {
  index: number;
  total: number;
}

export interface ExecutionPlan {
  tasks: PlannedTask[];
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
}

/**
 * Builds an execution plan from the parsed OpenSpec tasks.
 * Preserves the original file order as the default execution order.
 * Does not invent dependencies based on assumptions.
 */
export const buildExecutionPlan = (tasks: OpenSpecTask[]): ExecutionPlan => {
  const total = tasks.length;
  const plannedTasks: PlannedTask[] = tasks.map((task, index) => ({
    ...task,
    index: index + 1,
    total,
  }));

  const completedTasks = plannedTasks.filter((t) => t.completed).length;
  const pendingTasks = total - completedTasks;

  return {
    tasks: plannedTasks,
    totalTasks: total,
    completedTasks,
    pendingTasks,
  };
};
