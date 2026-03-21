import { Router, Request, Response, RequestHandler } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requirePermission } from '../../middleware/adminAuth';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * GET /api/v1/admin/seller-verification/queue
 * Returns sellers pending verification review.
 */
router.get(
  '/queue',
  requirePermission('review_sellers') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const status = (req.query.status as string) || 'PENDING';
      const page = parseInt(req.query.page as string) || 1;
      const limit = 20;
      const offset = (page - 1) * limit;

      // Fetch users with matching verification status
      const { data: users, error, count } = await supabase
        .from('users')
        .select('id, email, display_name, seller_verification_status, seller_verification_submitted_at, created_at', { count: 'exact' })
        .eq('seller_verification_status', status)
        .order('seller_verification_submitted_at', { ascending: true, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      // Fetch document counts per user
      const userIds = (users || []).map(u => u.id);
      let docCounts: Record<string, number> = {};

      if (userIds.length > 0) {
        const { data: docs } = await supabase
          .from('seller_verification_documents')
          .select('user_id')
          .in('user_id', userIds);

        if (docs) {
          for (const doc of docs) {
            docCounts[doc.user_id] = (docCounts[doc.user_id] || 0) + 1;
          }
        }
      }

      const queue = (users || []).map(u => ({
        userId: u.id,
        email: u.email,
        displayName: u.display_name,
        status: u.seller_verification_status,
        submittedAt: u.seller_verification_submitted_at,
        createdAt: u.created_at,
        documentCount: docCounts[u.id] || 0,
      }));

      // Pending count for stats
      const { count: pendingCount } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('seller_verification_status', 'PENDING');

      res.json({
        success: true,
        data: {
          queue,
          pagination: { page, limit, total: count || 0 },
          stats: { pendingCount: pendingCount || 0 },
        },
      });
    } catch (error) {
      console.error('Seller verification queue error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch verification queue' });
    }
  }
);

/**
 * GET /api/v1/admin/seller-verification/:userId
 * Returns user detail + all documents + review history.
 */
router.get(
  '/:userId',
  requirePermission('review_sellers') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;

      // Fetch user
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('id, email, display_name, seller_verification_status, seller_verification_submitted_at, seller_verification_reviewed_at, seller_verification_rejection_reason, seller_tier, created_at')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      // Fetch documents
      const { data: documents } = await supabase
        .from('seller_verification_documents')
        .select('id, document_type, file_url, mime_type, file_size_bytes, status, reviewed_by, reviewed_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      // Fetch review history
      const { data: reviews } = await supabase
        .from('seller_verification_reviews')
        .select('id, admin_id, action, notes, previous_status, new_status, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            status: user.seller_verification_status,
            submittedAt: user.seller_verification_submitted_at,
            reviewedAt: user.seller_verification_reviewed_at,
            rejectionReason: user.seller_verification_rejection_reason,
            sellerTier: user.seller_tier,
            createdAt: user.created_at,
          },
          documents: documents || [],
          reviews: reviews || [],
        },
      });
    } catch (error) {
      console.error('Seller verification detail error:', error);
      res.status(500).json({ success: false, error: 'Failed to fetch verification detail' });
    }
  }
);

/**
 * POST /api/v1/admin/seller-verification/:userId/approve
 * Approves a seller's verification.
 */
router.post(
  '/:userId/approve',
  requirePermission('review_sellers') as unknown as RequestHandler,
  auditLog('approve_seller', 'users') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { notes } = req.body;

      if (!notes) {
        res.status(400).json({ success: false, error: 'notes is required' });
        return;
      }

      // Fetch current status
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('seller_verification_status')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (user.seller_verification_status !== 'PENDING') {
        res.status(412).json({ success: false, error: `Cannot approve from status: ${user.seller_verification_status}` });
        return;
      }

      const previousStatus = user.seller_verification_status;

      // Update user status
      const { error: updateError } = await supabase
        .from('users')
        .update({
          seller_verification_status: 'APPROVED',
          seller_verification_reviewed_at: new Date().toISOString(),
          seller_verification_rejection_reason: null,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Insert review record
      await supabase
        .from('seller_verification_reviews')
        .insert({
          user_id: userId,
          admin_id: req.admin!.admin_id,
          action: 'approve',
          notes,
          previous_status: previousStatus,
          new_status: 'APPROVED',
        });

      res.json({ success: true, data: { userId, status: 'APPROVED' } });
    } catch (error) {
      console.error('Approve seller error:', error);
      res.status(500).json({ success: false, error: 'Failed to approve seller' });
    }
  }
);

/**
 * POST /api/v1/admin/seller-verification/:userId/reject
 * Rejects a seller's verification with reason.
 */
router.post(
  '/:userId/reject',
  requirePermission('review_sellers') as unknown as RequestHandler,
  auditLog('reject_seller', 'users') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { reason, notes } = req.body;

      if (!reason || !notes) {
        res.status(400).json({ success: false, error: 'reason and notes are required' });
        return;
      }

      // Fetch current status
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('seller_verification_status')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (user.seller_verification_status !== 'PENDING') {
        res.status(412).json({ success: false, error: `Cannot reject from status: ${user.seller_verification_status}` });
        return;
      }

      const previousStatus = user.seller_verification_status;

      // Update user status
      const { error: updateError } = await supabase
        .from('users')
        .update({
          seller_verification_status: 'REJECTED',
          seller_verification_reviewed_at: new Date().toISOString(),
          seller_verification_rejection_reason: reason,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Insert review record
      await supabase
        .from('seller_verification_reviews')
        .insert({
          user_id: userId,
          admin_id: req.admin!.admin_id,
          action: 'reject',
          notes,
          previous_status: previousStatus,
          new_status: 'REJECTED',
        });

      res.json({ success: true, data: { userId, status: 'REJECTED' } });
    } catch (error) {
      console.error('Reject seller error:', error);
      res.status(500).json({ success: false, error: 'Failed to reject seller' });
    }
  }
);

/**
 * POST /api/v1/admin/seller-verification/:userId/revoke
 * Revokes a previously approved seller's verification.
 */
router.post(
  '/:userId/revoke',
  requirePermission('review_sellers') as unknown as RequestHandler,
  auditLog('revoke_seller', 'users') as unknown as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      const { reason, notes } = req.body;

      if (!reason || !notes) {
        res.status(400).json({ success: false, error: 'reason and notes are required' });
        return;
      }

      // Fetch current status
      const { data: user, error: userError } = await supabase
        .from('users')
        .select('seller_verification_status')
        .eq('id', userId)
        .single();

      if (userError || !user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (user.seller_verification_status !== 'APPROVED') {
        res.status(412).json({ success: false, error: `Cannot revoke from status: ${user.seller_verification_status}` });
        return;
      }

      const previousStatus = user.seller_verification_status;

      // Update user status
      const { error: updateError } = await supabase
        .from('users')
        .update({
          seller_verification_status: 'REVOKED',
          seller_verification_reviewed_at: new Date().toISOString(),
          seller_verification_rejection_reason: reason,
        })
        .eq('id', userId);

      if (updateError) throw updateError;

      // Insert review record
      await supabase
        .from('seller_verification_reviews')
        .insert({
          user_id: userId,
          admin_id: req.admin!.admin_id,
          action: 'revoke',
          notes,
          previous_status: previousStatus,
          new_status: 'REVOKED',
        });

      res.json({ success: true, data: { userId, status: 'REVOKED' } });
    } catch (error) {
      console.error('Revoke seller error:', error);
      res.status(500).json({ success: false, error: 'Failed to revoke seller verification' });
    }
  }
);

export default router;
