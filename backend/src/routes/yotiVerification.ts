/**
 * Yoti verification routes — user-facing, mounted at /api/v1/verification.
 *
 * Static routes (/start, /status) registered before any parameterized routes
 * per Lesson #5 (Express). At present no parameterized routes are wired here
 * — keep that property if any are added later.
 */

import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import {
  startYotiSession,
  getMyVerificationStatus,
} from '../controllers/yotiVerificationController';

const router = Router();

/** 5 req/min per authenticated user for /start (creates billable Yoti sessions). */
const startLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'resource_exhausted', message: 'Too many verification attempts. Please slow down.' } },
});

router.post(
  '/start',
  requireAuth as unknown as RequestHandler,
  startLimit as unknown as RequestHandler,
  startYotiSession as unknown as RequestHandler,
);

router.get(
  '/status',
  requireAuth as unknown as RequestHandler,
  getMyVerificationStatus as unknown as RequestHandler,
);

export default router;
