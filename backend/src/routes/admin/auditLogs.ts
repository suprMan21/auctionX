import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth, requirePermission } from '../../middleware/adminAuth';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

router.get(
  '/',
  verifyAdminAuth,
  requirePermission('view_audit_logs'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const admin = req.query.admin as string;
      const action = req.query.action as string;
      const entityType = req.query.entity as string;

      const offset = (page - 1) * limit;

      let query = supabase
        .from('audit_logs')
        .select('*', { count: 'exact' });

      if (admin) {
        query = query.eq('admin_id', admin);
      }

      if (action) {
        query = query.eq('action', action);
      }

      if (entityType) {
        query = query.eq('entity_type', entityType);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        logs: data || [],
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    } catch (error) {
      console.error('Get audit logs error:', error);
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  }
);

export default router;
