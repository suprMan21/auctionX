import { Router, Request, Response } from 'express';

const router = Router();

/**
 * POST /api/v1/admin/disputes/:settlementId/approve
 * Approve a buyer dispute — TODO: trigger refund to buyer.
 */
router.post('/:settlementId/approve', (_req: Request, res: Response) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented — dispute approval and buyer refund coming in Module 13+',
  });
});

/**
 * POST /api/v1/admin/disputes/:settlementId/reject
 * Reject a buyer dispute — TODO: release escrow to seller.
 */
router.post('/:settlementId/reject', (_req: Request, res: Response) => {
  res.status(501).json({
    success: false,
    error: 'Not implemented — dispute rejection and escrow release coming in Module 13+',
  });
});

export default router;
