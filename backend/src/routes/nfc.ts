import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import {
  registerTag,
  scanTag,
  uploadProof,
  getTagVerification,
  transferOwnership,
  mintNft,
} from '../controllers/nfcController';

/** 30 req/min per IP for NFC scan POSTs. */
const nfcScanLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many scan requests. Please slow down.' },
});

/** 120 req/min per IP for tag verification page views. */
const verifyPageLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many verification requests. Please slow down.' },
});

// Mounted at /api/v1/nfc
export const nfcRoutes = Router();

// Static routes BEFORE parameterized routes (lesson #5)
nfcRoutes.post('/register', requireAuth, registerTag as unknown as RequestHandler);
nfcRoutes.post('/scan', nfcScanLimit, scanTag as unknown as RequestHandler);
nfcRoutes.post('/proof', requireAuth, uploadProof as unknown as RequestHandler);
nfcRoutes.post('/transfer', requireAuth, transferOwnership as unknown as RequestHandler);
nfcRoutes.post('/mint', requireAuth, mintNft as unknown as RequestHandler);

// Parameterized route LAST
nfcRoutes.get('/:tagId', verifyPageLimit, getTagVerification as unknown as RequestHandler);
