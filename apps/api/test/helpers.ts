import { ExecutionContext } from '@nestjs/common';

/** Minimal fake ExecutionContext for guard tests. */
export function fakeContext(req: Record<string, unknown>): ExecutionContext {
  const handler = () => undefined;
  class FakeController {}
  return {
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
  } as unknown as ExecutionContext;
}

/** Reflector stub returning metadata by key. */
export function fakeReflector(meta: Record<string, unknown>) {
  return { getAllAndOverride: (key: string) => meta[key] } as never;
}
