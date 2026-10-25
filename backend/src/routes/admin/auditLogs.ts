import { Router } from 'express';
import { requirePermission } from '../../middleware/adminAuth';
import { PERMISSIONS } from '../../lib/admin/permissions';
import { handle } from '../tagManagement';
import { auditLogFacets, listAuditLogs } from '../../controllers/adminAccountsController';

/** Audit trail viewer: filter by actor, action, entity type and target (S-ADMIN2). */
const router = Router();

router.use(requirePermission(PERMISSIONS.viewAuditLogs));
router.get('/facets', handle(auditLogFacets));
router.get('/', handle(listAuditLogs));

export default router;
