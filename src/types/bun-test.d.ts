declare module 'bun:test' {
  export type TestFn = (() => void | Promise<void>);

  export function describe(name: string, fn: TestFn): void;
  export function it(name: string, fn: TestFn): void;
  export function test(name: string, fn: TestFn): void;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;

  export const expect: {
    (actual: unknown): {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toContain(expected: unknown): void;
      toBeTruthy(): void;
      toBeFalsy(): void;
      toBeGreaterThan(expected: number): void;
      toBeLessThan(expected: number): void;
      toBeDefined(): void;
      toBeUndefined(): void;
      toBeNull(): void;
      toThrow(): void;
      toThrowError(expected?: string | RegExp): void;
      toBeInstanceOf(expected: Function): void;
      toHaveLength(expected: number): void;
      toHaveProperty(expected: string | string[], value?: unknown): void;
      toMatch(expected: string | RegExp): void;
      [key: string]: any;
    };
    [key: string]: any;
  };
}
