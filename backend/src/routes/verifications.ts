import { Router, RequestHandler } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  createVerification,
  getUploadUrl,
  confirmVideoUpload,
  registerNfc,
  getVerificationByToken,
  incrementScanCount,
} from '../controllers/verificationController';

// Mounted at /api/v1/verifications (authenticated endpoints)
export const verificationRoutes = Router();

verificationRoutes.post('/create', requireAuth, createVerification as unknown as RequestHandler);
verificationRoutes.post('/:id/upload-url', requireAuth, getUploadUrl as unknown as RequestHandler);
verificationRoutes.post('/:id/upload-video', requireAuth, confirmVideoUpload as unknown as RequestHandler);
verificationRoutes.post('/:id/register-nfc', requireAuth, registerNfc as unknown as RequestHandler);

// Mounted at /api/v1/verify (public endpoints)
export const publicVerificationRoutes = Router();

publicVerificationRoutes.get('/:tokenName', getVerificationByToken as unknown as RequestHandler);
publicVerificationRoutes.post('/:tokenName/scan', incrementScanCount as unknown as RequestHandler);
