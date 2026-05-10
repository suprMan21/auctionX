import { Router, RequestHandler } from 'express';
import { createOnboardingLink, getConnectStatus } from '../controllers/stripeConnectController';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.post('/onboarding-link', requireAuth, createOnboardingLink as unknown as RequestHandler);
router.get('/status', requireAuth, getConnectStatus as unknown as RequestHandler);

export default router;
