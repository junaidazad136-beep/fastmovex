/** Error thrown by both the server and browser API clients. `body` is the API's JSON error. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { message?: string | string[]; reason?: string; statusCode?: number; [k: string]: unknown } | null,
  ) {
    super(ApiError.messageOf(body) ?? `HTTP ${status}`);
    this.name = 'ApiError';
  }

  get reason(): string | undefined {
    return typeof this.body?.reason === 'string' ? this.body.reason : undefined;
  }

  static messageOf(body: ApiError['body']): string | undefined {
    if (!body?.message) return undefined;
    return Array.isArray(body.message) ? body.message.join('. ') : body.message;
  }
}

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super('Network error');
    this.name = 'NetworkError';
    this.cause = cause;
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}
