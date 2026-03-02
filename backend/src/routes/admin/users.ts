import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth, requirePermission } from '../../middleware/adminAuth';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

router.get(
  '/',
  verifyAdminAuth,
  requirePermission('view_users'),
  async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 50;
      const search = req.query.search as string;
      const status = req.query.status as string;

      const offset = (page - 1) * limit;

      let query = supabase
        .from('users')
        .select('*', { count: 'exact' });

      if (search) {
        query = query.or(`email.ilike.%${search}%,display_name.ilike.%${search}%`);
      }

      if (status === 'suspended') {
        query = query.eq('is_suspended', true);
      } else if (status === 'banned') {
        query = query.eq('is_banned', true);
      } else if (status === 'active') {
        query = query.eq('is_suspended', false).eq('is_banned', false);
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        users: data,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    } catch (error) {
      console.error('List users error:', error);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  }
);

router.get(
  '/:userId',
  verifyAdminAuth,
  requirePermission('view_users'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) throw error;

      const { data: listings, error: listingsError } = await supabase
        .from('listings')
        .select('id, status')
        .eq('seller_id', userId);

      if (listingsError) throw listingsError;

      const stats = {
        listingsCount: listings.length,
        activeListingsCount: listings.filter(l => l.status === 'active').length,
        soldListingsCount: listings.filter(l => l.status === 'sold').length
      };

      res.json({
        user,
        stats
      });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Failed to fetch user' });
    }
  }
);

router.post(
  '/:userId/suspend',
  verifyAdminAuth,
  requirePermission('manage_users'),
  auditLog('suspend_user', 'user'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { durationHours, reason } = req.body;

      if (!durationHours || !reason) {
        res.status(400).json({ error: 'durationHours and reason are required' });
        return;
      }

      const { error } = await supabase.rpc('suspend_user', {
        p_user_id: userId,
        p_duration_hours: durationHours,
        p_reason: reason,
        p_admin_id: req.admin!.admin_id
      });

      if (error) throw error;

      res.json({ success: true, message: 'User suspended' });
    } catch (error) {
      console.error('Suspend user error:', error);
      res.status(500).json({ error: 'Failed to suspend user' });
    }
  }
);

router.post(
  '/:userId/unsuspend',
  verifyAdminAuth,
  requirePermission('manage_users'),
  auditLog('unsuspend_user', 'user'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const { error } = await supabase.rpc('unsuspend_user', {
        p_user_id: userId,
        p_admin_id: req.admin!.admin_id
      });

      if (error) throw error;

      res.json({ success: true, message: 'User unsuspended' });
    } catch (error) {
      console.error('Unsuspend user error:', error);
      res.status(500).json({ error: 'Failed to unsuspend user' });
    }
  }
);

router.post(
  '/:userId/ban',
  verifyAdminAuth,
  requirePermission('manage_users'),
  auditLog('ban_user', 'user'),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      if (!reason) {
        res.status(400).json({ error: 'reason is required' });
        return;
      }

      const { error } = await supabase.rpc('ban_user', {
        p_user_id: userId,
        p_reason: reason,
        p_admin_id: req.admin!.admin_id
      });

      if (error) throw error;

      res.json({ success: true, message: 'User banned' });
    } catch (error) {
      console.error('Ban user error:', error);
      res.status(500).json({ error: 'Failed to ban user' });
    }
  }
);

router.post(
  '/:userId/unban',
  verifyAdminAuth,
  requirePermission('manage_users'),
  auditLog('unban_user', 'user'),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const { error } = await supabase.rpc('unban_user', {
        p_user_id: userId,
        p_admin_id: req.admin!.admin_id
      });

      if (error) throw error;

      res.json({ success: true, message: 'User unbanned' });
    } catch (error) {
      console.error('Unban user error:', error);
      res.status(500).json({ error: 'Failed to unban user' });
    }
  }
);

export default router;
