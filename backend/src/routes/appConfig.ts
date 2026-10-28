import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { appConfigPayload } from '../lib/appVersion';

/**
 * S-MOB1: GET /api/v1/app-config — public, no sign-in. The Creator app reads
 * its minimum version and the store link here at start-up. Versions and
 * https links only; nothing about any account.
 */
export const appConfigRoutes = Router();

const limit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please slow down.' },
});

appConfigRoutes.get('/', limit, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ success: true, data: appConfigPayload(), error: null });
});
