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

/** A message a staff member can act on, for toasts and form banners. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return ApiError.messageOf(e.body) ?? 'You do not have permission to do this.';
    if (e.status === 429) return e.reason ? e.message : 'Too many requests. Wait a moment and try again.';
    if (e.status >= 500) return 'Something went wrong on the server. Try again.';
    return e.message;
  }
  if (e instanceof NetworkError) return 'Cannot reach the server. Check your connection.';
  return 'Something went wrong. Try again.';
}
