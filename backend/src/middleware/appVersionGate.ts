import type { NextFunction, Request, Response } from 'express';
import { checkAppVersion } from '../lib/appVersion';

/** Paths an out-of-date app must still reach: it reads its minimum here. */
const EXEMPT = new Set(['/api/v1/app-config']);

export const APP_UPDATE_REQUIRED = 'app_update_required';

/**
 * S-MOB1: refuses Creator-app requests below the minimum version (426, reason
 * `app_update_required`). The server check is what enforces the minimum; the
 * app's own start-up check only makes it friendlier. Requests without app
 * headers (the website, webhooks, cron) pass untouched.
 */
export const appVersionGate = (req: Request, res: Response, next: NextFunction): void => {
  const path = (req.originalUrl ?? req.url).split('?')[0];
  if (EXEMPT.has(path)) {
    next();
    return;
  }
  const verdict = checkAppVersion(req.get('x-app-version'), req.get('x-app-platform'));
  if (verdict === 'update_required') {
    res.status(426).json({
      success: false,
      data: null,
      error: 'This version of the app is too old. Update it to keep going.',
      code: 'upgrade_required',
      reason: APP_UPDATE_REQUIRED,
    });
    return;
  }
  next();
};
