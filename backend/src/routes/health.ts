import { Router } from 'express';

const router = Router();

/**
 * GET /api/v1/health
 * Lightweight liveness check — returns 200 immediately.
 */
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    ts: new Date().toISOString()
  });
});

export default router;
