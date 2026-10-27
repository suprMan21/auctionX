import { Router, type NextFunction, type Request, type Response } from 'express';
import { handle } from '../tagManagement';
import { requireStepUp } from '../../middleware/mfaGates';
import { visibleApprovalActions } from '../../lib/admin/approvals';
import {
  approveApproval,
  cancelApproval,
  listApprovals,
  rejectApproval,
} from '../../controllers/adminApprovalsController';

/**
 * S-2FA Ph3a two-admin approval queue. The admin index has already run
 * verifyAdminAuth + adminRateLimit. Open to any admin holding a permission of
 * an approval action (manage_nfc or manage_users); the controller and the
 * database functions check the exact permission per request.
 */
const router = Router();

router.use((req: Request, res: Response, next: NextFunction) => {
  if (visibleApprovalActions(req.admin).length === 0) {
    res.status(403).json({ success: false, data: null, error: 'Your staff role cannot do this.', code: 'FORBIDDEN' });
    return;
  }
  next();
});

router.get('/', handle(listApprovals));
// Approving always needs a fresh passkey check bound to this request (admin step-ups are passkey only).
router.post('/:id/approve', requireStepUp('admin_approve', (req) => req.params.id, { always: true }), handle(approveApproval));
router.post('/:id/reject', handle(rejectApproval));
router.post('/:id/cancel', handle(cancelApproval));

export default router;
