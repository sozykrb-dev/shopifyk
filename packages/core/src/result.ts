/**
 * A tiny Result type.
 *
 * Auth flows (login, 2FA, password reset) must not throw for expected
 * failures -- "wrong password" is a value, not an exception -- while still
 * never leaking whether an account exists. Server Actions return Results so the
 * UI can render field errors without try/catch gymnastics.
 */
export type Result<T, E = { code: string; message: string; field?: string }> =
  { ok: true; value: T } | { ok: false; error: E };

export type ActionError = { code: string; message: string; field?: string };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E extends ActionError>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}

/** Wraps a throwing async function into a Result. Unexpected errors still throw. */
export async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, ActionError>> {
  try {
    return ok(await fn());
  } catch (error) {
    return err({
      code: error instanceof Error && 'code' in error ? String(error.code) : 'internal_error',
      message: error instanceof Error ? error.message : 'Something went wrong.',
    });
  }
}
