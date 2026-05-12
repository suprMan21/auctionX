import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { generatePresignedUrl } from '../lib/s3';
import { notificationService } from '../lib/notifications/notificationService';

interface VerificationRequest extends Request, RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/v1/verifications/create
 * Creates a new item_verification record for a listing owned by the requesting user.
 * Generates a unique token name via the generate_token_name RPC.
 */
export const createVerification = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { listingId } = req.body as { listingId?: string };
    if (!listingId) throw new AppError('invalid_argument', 'listingId is required');

    const supabase = getServiceClient();

    // Confirm the listing belongs to the requesting user
    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, seller_id')
      .eq('id', listingId)
      .maybeSingle();

    if (listingError || !listing) {
      throw new AppError('not_found', 'Listing not found');
    }
    if (listing.seller_id !== userId) {
      throw new AppError('permission_denied', 'You do not own this listing');
    }

    // Generate unique token name
    const { data: tokenNameData, error: rpcError } = await supabase
      .rpc('generate_token_name', { p_user_id: userId });

    if (rpcError || !tokenNameData) {
      logger.error('generate_token_name_failed', { userId, error: rpcError });
      throw new AppError('internal', 'Failed to generate token name');
    }

    const tokenName = tokenNameData as string;

    // Insert verification record
    const { data: verification, error: insertError } = await supabase
      .from('item_verifications')
      .insert({
        listing_id: listingId,
        seller_id: userId,
        token_name: tokenName,
        current_owner_id: userId,
        status: 'PENDING',
      })
      .select()
      .single();

    if (insertError) {
      // Handle unique token_name collision (race condition)
      if ((insertError as { code?: string }).code === '23505') {
        throw new AppError('conflict', 'Token name conflict — please try again');
      }
      logger.error('create_verification_failed', { listingId, error: insertError });
      throw new AppError('internal', 'Failed to create verification');
    }

    logger.info('verification_created', { verificationId: verification.id, tokenName });

    return res.status(201).json({ success: true, data: verification });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/verifications/:id/upload-url
 * Returns a presigned S3 PUT URL for uploading the possession-proof video.
 */
export const getUploadUrl = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id: verificationId } = req.params;
    const { mimeType = 'video/webm' } = req.body as { mimeType?: string };

    const supabase = getServiceClient();

    const { data: verif, error } = await supabase
      .from('item_verifications')
      .select('id, seller_id, status')
      .eq('id', verificationId)
      .maybeSingle();

    if (error || !verif) throw new AppError('not_found', 'Verification not found');
    if (verif.seller_id !== userId) throw new AppError('permission_denied', 'Access denied');

    const ext = mimeType === 'video/mp4' ? 'mp4' : 'webm';
    const s3Key = `verifications/${verificationId}/creation.${ext}`;

    const { uploadUrl, publicUrl } = await generatePresignedUrl(s3Key, mimeType);

    logger.info('upload_url_generated', { verificationId, s3Key });

    return res.json({ success: true, data: { uploadUrl, videoKey: s3Key, publicUrl } });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    logger.error('get_upload_url_error', { error });
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/verifications/:id/upload-video
 * Confirms video upload and updates verification status.
 * Validates: duration 15–30s, videoUrl contains S3 bucket name.
 */
export const confirmVideoUpload = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id: verificationId } = req.params;
    const { videoUrl, durationSeconds } = req.body as {
      videoUrl?: string;
      durationSeconds?: number;
    };

    if (!videoUrl) throw new AppError('invalid_argument', 'videoUrl is required');
    if (durationSeconds === undefined) throw new AppError('invalid_argument', 'durationSeconds is required');
    if (durationSeconds < 15 || durationSeconds > 30) {
      throw new AppError('invalid_argument', 'Video must be between 15 and 30 seconds');
    }

    const bucket = process.env.S3_BUCKET_NAME || 'auctionx-media-prod-cl';
    if (!videoUrl.includes(bucket)) {
      throw new AppError('invalid_argument', 'Invalid video URL');
    }

    const supabase = getServiceClient();

    const { data: verif, error } = await supabase
      .from('item_verifications')
      .select('id, seller_id, status, nfc_tag_uid')
      .eq('id', verificationId)
      .maybeSingle();

    if (error || !verif) throw new AppError('not_found', 'Verification not found');
    if (verif.seller_id !== userId) throw new AppError('permission_denied', 'Access denied');

    // If NFC already registered, move directly to VERIFIED
    const newStatus = verif.nfc_tag_uid ? 'VERIFIED' : 'VIDEO_UPLOADED';

    const { data: updated, error: updateError } = await supabase
      .from('item_verifications')
      .update({
        video_url: videoUrl,
        video_duration_seconds: durationSeconds,
        status: newStatus,
      })
      .eq('id', verificationId)
      .select()
      .single();

    if (updateError || !updated) {
      logger.error('confirm_video_upload_failed', { verificationId, error: updateError });
      throw new AppError('internal', 'Failed to update verification');
    }

    logger.info('video_upload_confirmed', { verificationId, status: newStatus });

    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/verifications/:id/register-nfc
 * Registers an NFC tag UID to this verification.
 * Rejects if the UID is already registered to a different item.
 */
export const registerNfc = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const { id: verificationId } = req.params;
    const { nfcTagUid } = req.body as { nfcTagUid?: string };

    if (!nfcTagUid) throw new AppError('invalid_argument', 'nfcTagUid is required');

    const supabase = getServiceClient();

    const { data: verif, error } = await supabase
      .from('item_verifications')
      .select('id, seller_id, status, video_url')
      .eq('id', verificationId)
      .maybeSingle();

    if (error || !verif) throw new AppError('not_found', 'Verification not found');
    if (verif.seller_id !== userId) throw new AppError('permission_denied', 'Access denied');

    // Check NFC UID not already used by another verification
    const { data: existing } = await supabase
      .from('item_verifications')
      .select('id')
      .eq('nfc_tag_uid', nfcTagUid)
      .neq('id', verificationId)
      .maybeSingle();

    if (existing) {
      throw new AppError('conflict', 'NFC tag already registered to another item');
    }

    // If video already uploaded, move to VERIFIED
    const newStatus = verif.video_url ? 'VERIFIED' : 'NFC_PROGRAMMED';

    const { data: updated, error: updateError } = await supabase
      .from('item_verifications')
      .update({
        nfc_tag_uid: nfcTagUid,
        nfc_programmed_at: new Date().toISOString(),
        status: newStatus,
      })
      .eq('id', verificationId)
      .select()
      .single();

    if (updateError || !updated) {
      logger.error('register_nfc_failed', { verificationId, error: updateError });
      throw new AppError('internal', 'Failed to register NFC tag');
    }

    logger.info('nfc_registered', { verificationId, nfcTagUid, status: newStatus });

    return res.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/verify/:tokenName
 * Public endpoint — returns full verification detail including listing, media, and ownership history.
 * Increments view_count on each call.
 */
export const getVerificationByToken = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { tokenName } = req.params;
    const supabase = getServiceClient();

    const { data: verif, error } = await supabase
      .from('item_verifications')
      .select(`
        *,
        listing:listings(
          title,
          description,
          listing_media(url, type, sort_order)
        ),
        ownership_transfers(
          id,
          from_user_id,
          to_user_id,
          transfer_type,
          settlement_id,
          transferred_at
        )
      `)
      .eq('token_name', tokenName)
      .maybeSingle();

    if (error || !verif) {
      return res.status(404).json({ success: false, error: 'Verification not found' });
    }

    // Increment view_count (non-fatal)
    await supabase
      .from('item_verifications')
      .update({ view_count: (verif.view_count ?? 0) + 1 })
      .eq('id', verif.id);

    // Fetch seller display name
    const { data: seller } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', verif.seller_id)
      .maybeSingle();

    // Fetch current owner display name
    const { data: currentOwner } = verif.current_owner_id
      ? await supabase.from('users').select('display_name').eq('id', verif.current_owner_id).maybeSingle()
      : { data: null };

    const { data: tagRecord } = verif.nfc_tag_uid
      ? await supabase
          .from('nfc_tags')
          .select('id')
          .eq('tag_uid', verif.nfc_tag_uid)
          .maybeSingle()
      : { data: null };

    const { data: nftData } = tagRecord
      ? await supabase
          .from('nft_metadata')
          .select('chain, contract_address, token_id, mint_tx_hash, metadata_uri')
          .eq('tag_id', tagRecord.id)
          .maybeSingle()
      : { data: null };

    const transferUserIds = [...new Set([
      ...(verif.ownership_transfers ?? []).map((t: { from_user_id: string | null }) => t.from_user_id).filter(Boolean) as string[],
      ...(verif.ownership_transfers ?? []).map((t: { to_user_id: string }) => t.to_user_id),
    ])];

    const userMap: Record<string, string> = {};
    if (transferUserIds.length > 0) {
      const { data: transferUsers } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', transferUserIds);
      (transferUsers ?? []).forEach((u: { id: string; display_name: string | null }) => {
        userMap[u.id] = u.display_name ?? u.id.slice(0, 8);
      });
    }

    logger.info('verification_viewed', { tokenName, verificationId: verif.id });

    return res.json({
      success: true,
      data: {
        ...verif,
        seller: seller ?? null,
        current_owner: currentOwner ?? null,
        nft: nftData ?? null,
        ownership_transfers: (verif.ownership_transfers ?? []).map((t: {
          id: string;
          from_user_id: string | null;
          to_user_id: string;
          transfer_type: string;
          settlement_id: string | null;
          transferred_at: string;
        }) => ({
          ...t,
          from_display_name: t.from_user_id ? (userMap[t.from_user_id] ?? null) : null,
          to_display_name: userMap[t.to_user_id] ?? null,
        })),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/verify/:tokenName/scan
 * Public endpoint — increments scan_count.
 */
export const incrementScanCount = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { tokenName } = req.params;
    const supabase = getServiceClient();

    const { data: verif } = await supabase
      .from('item_verifications')
      .select('id, scan_count, current_owner_id, token_name')
      .eq('token_name', tokenName)
      .maybeSingle();

    if (!verif) {
      return res.status(404).json({ success: false, error: 'Verification not found' });
    }

    await supabase
      .from('item_verifications')
      .update({ scan_count: (verif.scan_count ?? 0) + 1 })
      .eq('id', verif.id);

    logger.info('verification_scanned', { tokenName, verificationId: verif.id });

    // Notify the current owner that their item was scanned (non-fatal)
    if (verif.current_owner_id) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      notificationService.send(supabase, {
        userId: verif.current_owner_id,
        type: 'ITEM_SCANNED',
        title: 'Your item was scanned',
        body: `Someone scanned your NFC-authenticated item (${verif.token_name}).`,
        actionUrl: `${frontendUrl}/verify/${verif.token_name}`,
        metadata: { verificationId: verif.id, tokenName: verif.token_name },
      }).catch((err: unknown) => {
        logger.warn('item_scanned_notification_failed', { error: String(err) });
      });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
