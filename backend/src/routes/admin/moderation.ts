import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth, requirePermission } from '../../middleware/adminAuth';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

router.get(
  '/queue',
  verifyAdminAuth,
  requirePermission('view_listings'),
  async (req, res) => {
    try {
      const status = (req.query.status as string) || 'pending';
      const brand = req.query.brand as string;
      const priority = req.query.priority as string;

      let query = supabase
        .from('moderation_queue')
        .select(`
          *,
          listings (
            id,
            title,
            description,
            seller_id
          )
        `)
        .eq('status', status);

      if (brand && req.admin!.brand !== 'both') {
        query = query.eq('brand', brand);
      } else if (req.admin!.brand !== 'both') {
        query = query.eq('brand', req.admin!.brand);
      }

      if (priority) {
        query = query.eq('priority', parseInt(priority));
      }

      const { data, error } = await query
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;

      const { data: stats } = await supabase
        .from('moderation_queue')
        .select('status', { count: 'exact' })
        .eq('brand', req.admin!.brand === 'both' ? brand || 'auctionx' : req.admin!.brand);

      res.json({
        queue: data || [],
        stats: {
          pendingCount: stats?.filter(s => s.status === 'pending').length || 0,
          inReviewCount: stats?.filter(s => s.status === 'in_review').length || 0
        }
      });
    } catch (error) {
      console.error('Get moderation queue error:', error);
      res.status(500).json({ error: 'Failed to fetch moderation queue' });
    }
  }
);

router.post(
  '/queue/:queueId/assign',
  verifyAdminAuth,
  requirePermission('moderate_listings'),
  async (req, res) => {
    try {
      const { queueId } = req.params;

      const { error } = await supabase
        .from('moderation_queue')
        .update({
          assigned_to: req.admin!.admin_id,
          assigned_at: new Date().toISOString(),
          status: 'in_review'
        })
        .eq('queue_id', queueId);

      if (error) throw error;

      res.json({ success: true, message: 'Queue item assigned' });
    } catch (error) {
      console.error('Assign queue error:', error);
      res.status(500).json({ error: 'Failed to assign queue item' });
    }
  }
);

router.post(
  '/queue/:queueId/resolve',
  verifyAdminAuth,
  requirePermission('moderate_listings'),
  auditLog('resolve_moderation', 'moderation_queue'),
  async (req, res) => {
    try {
      const { queueId } = req.params;
      const { action, notes } = req.body;

      if (!action || !notes) {
        res.status(400).json({ error: 'action and notes are required' });
        return;
      }

      const { error } = await supabase
        .from('moderation_queue')
        .update({
          resolved_by: req.admin!.admin_id,
          resolved_at: new Date().toISOString(),
          action_taken: action,
          resolution_notes: notes,
          status: action === 'approve' ? 'approved' : 'rejected'
        })
        .eq('queue_id', queueId);

      if (error) throw error;

      if (action === 'remove_listing') {
        const { data: queueItem } = await supabase
          .from('moderation_queue')
          .select('listing_id')
          .eq('queue_id', queueId)
          .single();

        if (queueItem) {
          await supabase
            .from('listings')
            .update({ status: 'cancelled' })
            .eq('id', queueItem.listing_id);
        }
      }

      res.json({ success: true, message: 'Moderation resolved' });
    } catch (error) {
      console.error('Resolve moderation error:', error);
      res.status(500).json({ error: 'Failed to resolve moderation' });
    }
  }
);

export default router;
