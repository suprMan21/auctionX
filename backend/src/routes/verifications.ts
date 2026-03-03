import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import {
  createVerification,
  getUploadUrl,
  confirmVideoUpload,
  registerNfc,
  getVerificationByToken,
  incrementScanCount,
} from '../controllers/verificationController';

/** 120 req/min per IP for verify page views (public, cacheable). */
const verifyPageLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many verification page requests. Please slow down.' },
});

/** 30 req/min per IP for NFC scan POSTs (physical scans; high rate = abuse). */
const nfcScanLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many scan requests. Please slow down.' },
});

// Mounted at /api/v1/verifications (authenticated endpoints)
export const verificationRoutes = Router();

verificationRoutes.post('/create', requireAuth, createVerification as unknown as RequestHandler);
verificationRoutes.post('/:id/upload-url', requireAuth, getUploadUrl as unknown as RequestHandler);
verificationRoutes.post('/:id/upload-video', requireAuth, confirmVideoUpload as unknown as RequestHandler);
verificationRoutes.post('/:id/register-nfc', requireAuth, registerNfc as unknown as RequestHandler);

// Mounted at /api/v1/verify (public endpoints)
export const publicVerificationRoutes = Router();

publicVerificationRoutes.get('/:tokenName', verifyPageLimit, getVerificationByToken as unknown as RequestHandler);
publicVerificationRoutes.post('/:tokenName/scan', nfcScanLimit, incrementScanCount as unknown as RequestHandler);
