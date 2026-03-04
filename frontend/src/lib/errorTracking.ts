/**
 * Error tracking stub.
 * Captures unhandled errors and promise rejections via console logging.
 * Structured for a drop-in Sentry swap — see commented sections below.
 *
 * @module Module 18 — Launch Prep
 */

// To activate Sentry:
// 1. npm install @sentry/react
// 2. Uncomment the Sentry import and init call in initErrorTracking()
// 3. Uncomment Sentry.captureException() in captureError()
// import * as Sentry from '@sentry/react';

/**
 * Initialise global error tracking.
 * Call once before createRoot().render() in main.tsx.
 *
 * Registers handlers for:
 * - Unhandled promise rejections (unhandledrejection)
 * - Uncaught synchronous errors (window.onerror)
 */
export const initErrorTracking = (): void => {
  // Sentry.init({
  //   dsn: import.meta.env.VITE_SENTRY_DSN,
  //   environment: import.meta.env.MODE,
  //   tracesSampleRate: 0.2,
  // });

  window.addEventListener('unhandledrejection', (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    captureError(error, { source: 'unhandledrejection' });
  });

  window.onerror = (message, source, lineno, colno, error) => {
    captureError(error ?? new Error(String(message)), {
      source: 'window.onerror',
      file: source,
      line: lineno,
      col: colno,
    });
    return false;
  };
};

/**
 * Capture and report a single error with optional context.
 *
 * @param error   - The error to capture
 * @param context - Optional key/value metadata for the error report
 */
export const captureError = (
  error: Error,
  context?: Record<string, unknown>
): void => {
  console.error('[Error Tracking]', error.message, { context, stack: error.stack });

  // Sentry.captureException(error, { extra: context });
};
