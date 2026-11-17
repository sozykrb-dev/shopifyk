/** Base class for every error the platform raises on purpose. */
export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, httpStatus = 500, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      httpStatus: this.httpStatus,
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

/** Missing or malformed configuration; thrown at boot, never at request time. */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super('configuration_error', message, 500);
  }
}

/** Input failed schema validation. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

/** No valid session / credentials. */
export class AuthenticationError extends AppError {
  constructor(message = 'You must sign in to continue.', code = 'authentication_required') {
    super(code, message, 401);
  }
}

/** Authenticated, but not allowed. */
export class AuthorizationError extends AppError {
  constructor(
    message = 'You do not have permission to perform this action.',
    details?: { permission?: string },
  ) {
    super('permission_denied', message, 403, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super('not_found', `${resource} was not found.`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, 409, details);
  }
}

export class RateLimitError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('rate_limited', 'Too many attempts. Please try again later.', 429, {
      retryAfterSeconds,
    });
  }
}

/**
 * Raised when code tries to touch tenant data without a tenant context, or
 * touches another tenant's data. This must never be swallowed: it is either a
 * bug or an attack.
 */
export class TenantIsolationError extends AppError {
  constructor(message = 'Cross-tenant data access was blocked.') {
    super('tenant_isolation_violation', message, 403);
  }
}

/** Maps unknown throwables to an AppError so no internals leak to clients. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    'internal_error',
    error instanceof Error ? error.message : 'An unexpected error occurred.',
    500,
  );
}

/** True for errors that are the caller's fault and should not page anyone. */
export function isClientError(error: AppError): boolean {
  return error.httpStatus >= 400 && error.httpStatus < 500;
}
