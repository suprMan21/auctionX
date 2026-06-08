import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { notificationService } from '../lib/notifications/notificationService';
import { generatePresignedUrl } from '../lib/s3';

interface PayoutRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * GET /api/v1/payouts
 * Returns all payouts for the authenticated seller.
 * Uses service client with explicit seller_id filter (RLS as defence-in-depth).
 */
export const listPayouts = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const supabase = getServiceClient();

    const { data: payouts, error } = await supabase
      .from('payouts')
      .select('*')
      .eq('seller_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('list_payouts_db_error', { userId, error });
      throw new AppError('internal', 'Failed to fetch payouts');
    }

    logger.info('payouts_listed', { userId, count: payouts?.length ?? 0 });

    return res.json({ success: true, data: payouts ?? [] });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/settlements/:id/dispute
 * Opens a dispute on an ESCROW_HOLD settlement.
 * Buyer only. Requires `reason` body field (min 20 chars).
 * Adds settlement to moderation_queue for admin review.
 */
export const openDispute = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const settlementId = req.params['id'] as string;
    const { reason, evidence_urls } = req.body as {
      reason?: string;
      evidence_urls?: string[];
    };

    if (!reason || reason.trim().length < 20) {
      throw new AppError('invalid_argument', 'Dispute reason must be at least 20 characters');
    }

    // Validate evidence URLs if provided. Each must be a string under 2KB and
    // point to our S3 bucket (defense against arbitrary URL injection in emails).
    const evidenceUrls = Array.isArray(evidence_urls) ? evidence_urls : [];
    if (evidenceUrls.length > 10) {
      throw new AppError('invalid_argument', 'Maximum 10 evidence files per dispute');
    }
    const s3Host = (process.env.AWS_S3_BUCKET || 'auctionx-media-prod-cl').toLowerCase();
    for (const url of evidenceUrls) {
      if (typeof url !== 'string' || url.length > 2048) {
        throw new AppError('invalid_argument', 'Invalid evidence URL');
      }
      const lowered = url.toLowerCase();
      if (!lowered.includes(s3Host) || !lowered.startsWith('https://')) {
        throw new AppError('invalid_argument', 'Evidence URLs must be HTTPS S3 URLs');
      }
    }

    const supabase = getServiceClient();

    // Fetch settlement to verify buyer and status
    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, buyer_id, seller_id, status, auction_id')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      throw new AppError('not_found', 'Settlement not found');
    }

    if (settlement.buyer_id !== userId) {
      throw new AppError('permission_denied', 'Only the buyer can open a dispute');
    }

    if (settlement.status !== 'ESCROW_HOLD') {
      throw new AppError(
        'conflict',
        `Cannot open dispute — settlement status is '${settlement.status}' (must be 'ESCROW_HOLD')`,
      );
    }

    const now = new Date().toISOString();

    // Update settlement → DISPUTED
    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'DISPUTED',
        dispute_reason: reason.trim(),
        dispute_opened_at: now,
        evidence_urls: evidenceUrls,
        updated_at: now,
      })
      .eq('id', settlementId);

    if (updateError) {
      logger.error('open_dispute_update_failed', { settlementId, error: updateError });
      throw new AppError('internal', 'Failed to open dispute');
    }

    // Add to moderation_queue for admin review
    const { error: mqError } = await supabase
      .from('moderation_queue')
      .insert({
        listing_id: null,
        reported_by: userId,
        reason: `Dispute: ${reason.trim().slice(0, 500)}`,
        status: 'PENDING',
      });

    if (mqError) {
      // Non-fatal — dispute status is already set; admin can find via settlements table
      logger.warn('open_dispute_moderation_queue_failed', { settlementId, error: mqError });
    }

    // Notify both seller and buyer about the dispute
    const sellerId = Array.isArray(settlement.seller_id) ? settlement.seller_id[0] : settlement.seller_id;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const settlementUrl = `${frontendUrl}/settlements/${settlementId}`;
    await notificationService.sendBatch(supabase, [
      {
        userId: sellerId,
        type: 'DISPUTE_OPENED',
        title: 'A dispute has been opened',
        body: 'The buyer has opened a dispute on your settlement. Our team will review it.',
        actionUrl: settlementUrl,
        metadata: { settlementId, buyerId: userId, isSeller: true },
      },
      {
        userId,
        type: 'DISPUTE_OPENED',
        title: 'Your dispute has been received',
        body: 'Your dispute is under review. Our moderation team will follow up.',
        actionUrl: settlementUrl,
        metadata: { settlementId, isSeller: false },
      },
    ]);

    logger.info('dispute_opened', { settlementId, buyerId: userId });

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('open_dispute_failed', { code: error.code, message: error.message });
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/settlements/:id/dispute/evidence
 * Returns a presigned S3 PUT URL for dispute evidence upload.
 * Buyer only. Must be invoked before opening (or while still in DISPUTED) the dispute.
 * Body: { filename, content_type }
 */
const ALLOWED_EVIDENCE_MIME = [
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'video/mp4', 'video/quicktime', 'video/webm',
  'application/pdf',
];

export const getDisputeEvidenceUploadUrl = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const settlementId = req.params['id'] as string;
    const { filename, content_type } = req.body as { filename?: string; content_type?: string };

    if (!filename || typeof filename !== 'string' || filename.length > 200) {
      throw new AppError('invalid_argument', 'Invalid filename');
    }
    if (!content_type || !ALLOWED_EVIDENCE_MIME.includes(content_type)) {
      throw new AppError(
        'invalid_argument',
        `Invalid content_type. Allowed: ${ALLOWED_EVIDENCE_MIME.join(', ')}`,
      );
    }

    const supabase = getServiceClient();
    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, buyer_id, status')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      throw new AppError('not_found', 'Settlement not found');
    }
    if (settlement.buyer_id !== userId) {
      throw new AppError('permission_denied', 'Only the buyer can upload dispute evidence');
    }
    if (settlement.status !== 'ESCROW_HOLD' && settlement.status !== 'DISPUTED') {
      throw new AppError(
        'conflict',
        `Cannot upload evidence — settlement status is '${settlement.status}'`,
      );
    }

    // Strip the filename to a safe slug + preserve extension.
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : 'bin';
    const safeExt = ext.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const s3Key = `disputes/${settlementId}/${userId}/${timestamp}-${random}.${safeExt}`;

    const { uploadUrl, publicUrl } = await generatePresignedUrl(s3Key, content_type);

    logger.info('dispute_evidence_upload_url_generated', { settlementId, userId, s3Key });

    return res.json({
      success: true,
      data: { uploadUrl, publicUrl, s3Key },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/settlements/:id/dispute/appeal
 * Opens an appeal on a rejected dispute. Buyer only.
 * Must be invoked within the 7-day window after rejection (settlements.appeal_deadline).
 * Body: { reason: string }
 *
 * Side effects: status transitions ESCROW_HOLD → APPEALED (and escrow_ends_at is
 * pushed forward 7 days so release-escrow does not pick it up during re-review).
 */
export const openDisputeAppeal = async (req: PayoutRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const settlementId = req.params['id'] as string;
    const { reason } = req.body as { reason?: string };

    if (!reason || reason.trim().length < 20) {
      throw new AppError('invalid_argument', 'Appeal reason must be at least 20 characters');
    }

    const supabase = getServiceClient();

    const { data: settlement, error: fetchError } = await supabase
      .from('settlements')
      .select('id, buyer_id, seller_id, status, resolution_action, appeal_deadline')
      .eq('id', settlementId)
      .single();

    if (fetchError || !settlement) {
      throw new AppError('not_found', 'Settlement not found');
    }
    if (settlement.buyer_id !== userId) {
      throw new AppError('permission_denied', 'Only the buyer can appeal a dispute decision');
    }
    if (settlement.resolution_action !== 'REJECTED') {
      throw new AppError(
        'conflict',
        `Cannot appeal — settlement was not rejected (resolution_action='${settlement.resolution_action ?? 'null'}')`,
      );
    }
    if (settlement.status !== 'ESCROW_HOLD') {
      throw new AppError(
        'conflict',
        `Cannot appeal — settlement status is '${settlement.status}' (must be 'ESCROW_HOLD')`,
      );
    }

    const now = new Date();
    if (!settlement.appeal_deadline || now > new Date(settlement.appeal_deadline)) {
      throw new AppError('conflict', 'Appeal window has expired');
    }

    const nowIso = now.toISOString();
    // Push escrow_ends_at 7 days out so release-escrow leaves the settlement alone
    // while the re-review happens.
    const pausedEscrowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: updateError } = await supabase
      .from('settlements')
      .update({
        status: 'DISPUTED',
        resolution_action: 'APPEALED',
        appeal_opened_at: nowIso,
        appeal_reason: reason.trim(),
        escrow_ends_at: pausedEscrowEnd,
        updated_at: nowIso,
      })
      .eq('id', settlementId);

    if (updateError) {
      logger.error('open_appeal_update_failed', { settlementId, error: updateError });
      throw new AppError('internal', 'Failed to open appeal');
    }

    const sellerId = Array.isArray(settlement.seller_id) ? settlement.seller_id[0] : settlement.seller_id;
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const settlementUrl = `${frontendUrl}/settlements/${settlementId}`;
    await notificationService.sendBatch(supabase, [
      {
        userId: sellerId,
        type: 'DISPUTE_APPEAL_OPENED',
        title: 'Buyer has appealed the dispute decision',
        body: 'The buyer has appealed. Escrow is paused pending our re-review.',
        actionUrl: settlementUrl,
        metadata: { settlementId, isSeller: true },
      },
      {
        userId,
        type: 'DISPUTE_APPEAL_OPENED',
        title: 'Your appeal has been received',
        body: 'Your appeal is under review.',
        actionUrl: settlementUrl,
        metadata: { settlementId, isSeller: false },
      },
    ]);

    logger.info('dispute_appeal_opened', { settlementId, buyerId: userId });

    return res.json({ success: true });
  } catch (error) {
    if (error instanceof AppError) {
      logger.warn('open_appeal_failed', { code: error.code, message: error.message });
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
