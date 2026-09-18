import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import { isMarketplaceEnabled } from '../lib/featureFlags';
import {
  registerTag,
  scanTag,
  uploadProof,
  confirmProof,
  getTagVerification,
  getTagByUid,
  transferOwnership,
  mintNft,
  listSellerTags,
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
nfcRoutes.get('/tags', requireAuth, listSellerTags as unknown as RequestHandler);
nfcRoutes.post('/scan', nfcScanLimit, scanTag as unknown as RequestHandler);
nfcRoutes.post('/proof', requireAuth, uploadProof as unknown as RequestHandler);
nfcRoutes.post('/proof/confirm', requireAuth, confirmProof as unknown as RequestHandler);

// ── Parked (S-ISO1) ─────────────────────────────────────────────────────────
// These three stay in the tree and keep typechecking; they are simply not
// registered while the marketplace is parked, so they 404.
//   /register  — validates itemId against `listings`, superseded by POST /enroll
//   /transfer  — one-sided, unpaid, instant; superseded by the two-sided
//                /transfer/initiate + /transfer/:id/complete flow. Leaving it
//                live would be a free path around the $2.50 transfer fee.
//   /mint      — the only NFT/IPFS path. "No NFTs, ever" (Locked, 2026-09-18).
if (isMarketplaceEnabled()) {
  nfcRoutes.post('/register', requireAuth, registerTag as unknown as RequestHandler);
  nfcRoutes.post('/transfer', requireAuth, transferOwnership as unknown as RequestHandler);
  nfcRoutes.post('/mint', requireAuth, mintNft as unknown as RequestHandler);
}

// Static routes BEFORE parameterized (lesson #5)
nfcRoutes.get('/by-uid/:tagUid', verifyPageLimit, getTagByUid as unknown as RequestHandler);

// Parameterized route LAST
nfcRoutes.get('/:tagId', verifyPageLimit, getTagVerification as unknown as RequestHandler);
