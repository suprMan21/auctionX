/**
 * search routes — mounted at /api/v1/search
 *
 * Public:
 *   GET /             → searchListings
 *
 * Authenticated (requireAuth):
 *   POST   /saved     → createSavedSearch
 *   GET    /saved     → getSavedSearches
 *   DELETE /saved/:id → deleteSavedSearch
 */
import { Router, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';
import {
  searchListings,
  createSavedSearch,
  getSavedSearches,
  deleteSavedSearch,
} from '../controllers/searchController';

const router = Router();

const searchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many search requests. Please slow down.' },
});

router.use(searchRateLimit);

router.get('/', searchListings as unknown as RequestHandler);
router.post('/saved', requireAuth, createSavedSearch as unknown as RequestHandler);
router.get('/saved', requireAuth, getSavedSearches as unknown as RequestHandler);
router.delete('/saved/:id', requireAuth, deleteSavedSearch as unknown as RequestHandler);

export default router;
