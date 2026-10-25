import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { handle } from '../tagManagement';
import { getAccountSettings, setDeleteWindow } from '../../controllers/adminAccountsController';

/** S-ADMIN2: the Retire -> Delete waiting window (default 24 h, min 1 h). */
const router = Router();

router.get('/', requirePermission(PERMISSIONS.viewUsers), handle(getAccountSettings));
router.put('/', requirePermission(PERMISSIONS.manageAdmins), handle(setDeleteWindow));

export default router;
