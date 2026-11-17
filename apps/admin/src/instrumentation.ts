/**
 * Boot-time instrumentation.
 *
 * Sentry is initialised only when a DSN is configured, so local development and
 * CI run without an external dependency. Error monitoring is wired here (and
 * not in a component) so server-side exceptions are captured from the very
 * first request.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const Sentry = await import('@sentry/nextjs');
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Errors are always sent; traces are sampled to keep costs predictable.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    // Never send cookies, authorization headers or card-adjacent fields.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
}
