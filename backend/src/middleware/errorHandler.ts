/**
 * Global Express error handler middleware.
 * Logs structured errors and returns safe responses (no stack trace in production).
 *
 * @module Module 18 — Launch Prep
 */

import { Request, Response, NextFunction } from 'express';
import { log } from '../lib/logger';

/**
 * Express 4-argument error handler.
 * Must be registered AFTER all routes via `app.use(errorHandler)`.
 *
 * @param err   - Any thrown or next(err) error
 * @param req   - Express request (used for requestId header)
 * @param res   - Express response
 * @param _next - Next function (required signature, unused)
 */
export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const requestId = req.headers['x-request-id'] as string | undefined;
  const status: number = err.statusCode ?? err.status ?? 500;

  log.error('unhandled_error', {
    error: err.message,
    stack: err.stack,
    requestId,
    status,
  });

  const isDev = process.env.NODE_ENV === 'development';

  res.status(status).json({
    error: err.message || 'Internal server error',
    requestId: requestId ?? null,
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  });
};
