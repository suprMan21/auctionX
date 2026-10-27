import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { handle } from '../tagManagement';
import { approvalGated } from '../../controllers/adminApprovalsController';
import {
  deleteAccount,
  getAccount,
  getAccountTokens,
  reactivateAccount,
  searchAccounts,
  setAccountRole,
  setAccountType,
  unsuspendAccount,
} from '../../controllers/adminAccountsController';

/**
 * S-ADMIN2 Ph1 account administration. The admin index has already run
 * verifyAdminAuth and adminRateLimit. Each database function re-checks the
 * permission and writes the single audit row, so there is no audit middleware
 * here (it used to write a second row per action).
 */
const router = Router();

router.get('/', requirePermission(PERMISSIONS.viewUsers), handle(searchAccounts));
router.get('/:id', requirePermission(PERMISSIONS.viewUsers), handle(getAccount));
router.get('/:id/tokens', requirePermission(PERMISSIONS.manageNfc), handle(getAccountTokens));

// S-2FA Ph3a: suspend and retire wait for a second admin unless the caller may act alone.
router.post('/:id/suspend', requirePermission(PERMISSIONS.manageUsers), handle(approvalGated('account_suspend')));
router.post('/:id/unsuspend', requirePermission(PERMISSIONS.manageUsers), handle(unsuspendAccount));
router.post('/:id/retire', requirePermission(PERMISSIONS.manageUsers), handle(approvalGated('account_retire')));
router.post('/:id/reactivate', requirePermission(PERMISSIONS.manageUsers), handle(reactivateAccount));

router.post('/:id/delete', requirePermission(PERMISSIONS.manageAdmins), handle(deleteAccount));
router.put('/:id/role', requirePermission(PERMISSIONS.manageAdmins), handle(setAccountRole));
router.put('/:id/type', requirePermission(PERMISSIONS.manageCreatorIds), handle(setAccountType));

export default router;
