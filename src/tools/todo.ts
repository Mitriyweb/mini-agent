import type { Tool, ToolDefinition } from '../types/tools.ts';

export enum TodoStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface TodoArgs {
  todos: TodoItem[];
  merge?: boolean;
}

const STATUSES: TodoStatus[] = [
  TodoStatus.PENDING,
  TodoStatus.IN_PROGRESS,
  TodoStatus.COMPLETED,
  TodoStatus.CANCELLED,
];

const normalizeItem = (item: any, index: number): TodoItem => {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`todos[${index}] must be an object.`);
  }
  const id = item.id;
  const content = item.content;
  const status = item.status;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`todos[${index}].id must be a non-empty string.`);
  }
  if (typeof content !== 'string') {
    throw new Error(`todos[${index}].content must be a string.`);
  }
  if (!STATUSES.includes(status)) {
    const allowed = STATUSES.join(', ');
    throw new Error(`todos[${index}].status must be one of: ${allowed}.`);
  }
  return { id, content, status };
};

const formatList = (items: TodoItem[]): string => {
  if (items.length === 0) return '(no todos)';
  const lines = items.map((item, index) => {
    const number = index + 1;
    const { status, id, content } = item;
    return `${number}. [${status}] ${id}: ${content}`;
  });
  return lines.join('\n');
};

export const todoDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'todo',
    description: 'Maintain and update structured task tracking list.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: {
                type: 'string',
                enum: [
                  TodoStatus.PENDING,
                  TodoStatus.IN_PROGRESS,
                  TodoStatus.COMPLETED,
                  TodoStatus.CANCELLED,
                ],
              },
            },
            required: ['id', 'content', 'status'],
          },
        },
        merge: {
          type: 'boolean',
          description: 'If true (default), merges with existing list by ID; if false, replaces list.',
        },
      },
      required: ['todos'],
    },
  },
};

export const createTodoTool = (): Tool<TodoArgs, string> => {
  let items: TodoItem[] = [];

  return {
    needsApproval: false,
    describe: () => 'update todo list',
    async execute(args) {
      const todos = args.todos;
      if (!Array.isArray(todos)) throw new Error('todos must be an array.');
      const merge = args.merge !== false;
      const next = todos.map(normalizeItem);
      if (!merge) {
        items = next;
        return formatList(items);
      }
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const item of next) {
        byId.set(item.id, item);
      }
      items = [...byId.values()];
      return formatList(items);
    },
    definition: todoDefinition,
  };
};
