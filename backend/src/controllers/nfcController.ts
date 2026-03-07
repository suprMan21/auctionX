import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RequestWithId } from '../middleware/requestId';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { generatePresignedUrl } from '../lib/s3';
import { validateScan, parseSunMessage, decryptPiccData, verifyCmac } from '../services/nfc/ntag424';
import { registerTagSchema, scanTagSchema, uploadProofSchema, transferSchema, mintSchema } from '../services/nfc/schemas';

interface NfcRequest extends RequestWithId, AuthRequest {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

/**
 * POST /api/v1/nfc/register
 * Register an NTAG 424 DNA tag for a listing.
 */
export const registerTag = async (req: NfcRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const parsed = registerTagSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
    }

    const { tagUid, aesKey, itemId, tenantId } = parsed.data;
    const supabase = getServiceClient();

    // If itemId provided, verify seller owns the listing
    if (itemId) {
      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .select('id, seller_id')
        .eq('id', itemId)
        .maybeSingle();

      if (listingError || !listing) throw new AppError('not_found', 'Listing not found');
      if (listing.seller_id !== userId) throw new AppError('permission_denied', 'You do not own this listing');
    }

    // Check if tag already exists for this tenant
    const { data: existingTag } = await supabase
      .from('nfc_tags')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('tag_uid', tagUid)
      .maybeSingle();

    if (existingTag) {
      throw new AppError('conflict', 'NFC tag already registered for this tenant');
    }

    // Look up existing item_verification for bridging
    let verificationId: string | null = null;
    if (itemId) {
      const { data: verif } = await supabase
        .from('item_verifications')
        .select('id')
        .eq('listing_id', itemId)
        .eq('seller_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (verif) verificationId = verif.id;
    }

    const { data: tag, error: insertError } = await supabase
      .from('nfc_tags')
      .insert({
        tenant_id: tenantId,
        tag_uid: tagUid,
        item_id: itemId ?? null,
        seller_id: userId,
        verification_id: verificationId,
        aes_key_enc: aesKey,
        status: 'registered',
      })
      .select()
      .single();

    if (insertError) {
      logger.error('register_tag_failed', { error: insertError });
      throw new AppError('internal', 'Failed to register NFC tag');
    }

    logger.info('nfc_tag_registered', { tagId: tag.id, tagUid, tenantId });

    return res.status(201).json({ success: true, data: tag });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/nfc/scan
 * Public endpoint — validates an NTAG 424 DNA SUN scan.
 */
export const scanTag = async (req: NfcRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const parsed = scanTagSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
    }

    const supabase = getServiceClient();
    const body = parsed.data;

    let tagUid: string;
    let sunMessage: string | null = null;
    let piccData: string | null = null;
    let cmac: string | null = null;

    if ('sunMessage' in body) {
      // Parse SUN URL to extract piccData and cmac
      const parts = parseSunMessage(body.sunMessage);
      if (!parts) throw new AppError('invalid_argument', 'Invalid SUN message URL');
      sunMessage = body.sunMessage;
      piccData = parts.encPiccData;
      cmac = parts.cmac;

      // We need to find the tag by trying to decrypt against known tags
      // For now, we'll need the tag_uid from the URL path or a lookup mechanism
      // The SUN URL typically includes the tag UID in the path
      const url = new URL(body.sunMessage);
      const pathParts = url.pathname.split('/').filter(Boolean);
      const uidFromPath = pathParts[pathParts.length - 1];
      if (!uidFromPath || !/^[0-9a-fA-F]+$/.test(uidFromPath)) {
        throw new AppError('invalid_argument', 'Cannot determine tag UID from SUN message');
      }
      tagUid = uidFromPath.toUpperCase();
    } else {
      tagUid = body.tagUid.toUpperCase();
      piccData = body.piccData;
      cmac = body.cmac;
    }

    // Look up the tag
    const { data: tag, error: tagError } = await supabase
      .from('nfc_tags')
      .select('id, tag_uid, aes_key_enc, sun_counter, verification_id, status')
      .eq('tag_uid', tagUid)
      .maybeSingle();

    if (tagError || !tag) {
      throw new AppError('not_found', 'NFC tag not found');
    }

    // Validate the scan cryptographically
    let cmacValid = false;
    let counterValue: number | null = null;

    if (sunMessage) {
      const result = validateScan({
        tagUid: tag.tag_uid,
        sunMessage,
        storedAesKey: tag.aes_key_enc,
        lastCounter: tag.sun_counter,
      });
      cmacValid = result.valid;
      counterValue = result.counterValue;

      if (!result.valid) {
        // Log failed scan but don't reveal internal details
        logger.warn('nfc_scan_failed', { tagId: tag.id, error: result.error });
      }
    } else if (piccData && cmac) {
      // Direct piccData + cmac validation
      const decrypted = decryptPiccData(piccData, tag.aes_key_enc);
      if (decrypted) {
        cmacValid = verifyCmac(piccData, tag.aes_key_enc, cmac);
        counterValue = decrypted.counter;
        if (decrypted.counter <= tag.sun_counter) {
          cmacValid = false;
          logger.warn('nfc_counter_replay', { tagId: tag.id });
        }
      }
    }

    // Update sun_counter if valid
    if (cmacValid && counterValue !== null) {
      await supabase
        .from('nfc_tags')
        .update({ sun_counter: counterValue, status: 'active', activated_at: tag.status === 'registered' ? new Date().toISOString() : undefined })
        .eq('id', tag.id);
    }

    // Insert verification event
    const { data: event, error: eventError } = await supabase
      .from('verification_events')
      .insert({
        tag_id: tag.id,
        scan_type: 'verification',
        scanned_by: req.user?.id ?? null,
        sun_message: sunMessage,
        sun_counter_value: counterValue,
        cmac_valid: cmacValid,
        ip_address: req.ip ?? null,
        user_agent: req.headers['user-agent'] ?? null,
      })
      .select()
      .single();

    if (eventError) {
      logger.error('verification_event_insert_failed', { tagId: tag.id, error: eventError });
    }

    // Backward compat: increment scan_count on linked item_verifications
    if (tag.verification_id) {
      const { data: verif } = await supabase
        .from('item_verifications')
        .select('scan_count')
        .eq('id', tag.verification_id)
        .maybeSingle();

      if (verif) {
        await supabase
          .from('item_verifications')
          .update({ scan_count: (verif.scan_count ?? 0) + 1 })
          .eq('id', tag.verification_id);
      }
    }

    logger.info('nfc_scan_processed', { tagId: tag.id, valid: cmacValid });

    return res.json({
      success: true,
      data: {
        valid: cmacValid,
        tagId: tag.id,
        eventId: event?.id ?? null,
        counterValue,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/nfc/proof
 * Generate a presigned S3 URL for video proof upload.
 */
export const uploadProof = async (req: NfcRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const parsed = uploadProofSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
    }

    const { tagId, contentType } = parsed.data;
    const supabase = getServiceClient();

    // Verify tag exists and user owns it
    const { data: tag, error } = await supabase
      .from('nfc_tags')
      .select('id, seller_id')
      .eq('id', tagId)
      .maybeSingle();

    if (error || !tag) throw new AppError('not_found', 'NFC tag not found');
    if (tag.seller_id !== userId) throw new AppError('permission_denied', 'You do not own this tag');

    const ext = contentType.includes('mp4') ? 'mp4' : 'webm';
    const s3Key = `nfc-proofs/${tagId}/proof.${ext}`;

    const { uploadUrl, publicUrl } = await generatePresignedUrl(s3Key, contentType);

    // Insert verification event for the proof
    await supabase
      .from('verification_events')
      .insert({
        tag_id: tagId,
        scan_type: 'proof_upload',
        scanned_by: userId,
        video_proof_url: publicUrl,
        video_proof_status: 'pending',
      });

    logger.info('nfc_proof_upload_url_generated', { tagId, s3Key });

    return res.json({ success: true, data: { uploadUrl, publicUrl, videoKey: s3Key } });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * GET /api/v1/nfc/:tagId
 * Public endpoint — returns full tag verification data.
 */
export const getTagVerification = async (req: NfcRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const { tagId } = req.params;
    const supabase = getServiceClient();

    const { data: tag, error } = await supabase
      .from('nfc_tags')
      .select('*')
      .eq('id', tagId)
      .maybeSingle();

    if (error || !tag) {
      return res.status(404).json({ success: false, error: 'NFC tag not found' });
    }

    // Fetch related data in parallel
    const [eventsResult, nftResult, verificationsResult] = await Promise.all([
      supabase
        .from('verification_events')
        .select('*')
        .eq('tag_id', tagId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('nft_metadata')
        .select('*')
        .eq('tag_id', tagId)
        .maybeSingle(),
      tag.verification_id
        ? supabase
            .from('item_verifications')
            .select('*, listing:listings(title, description, listing_media(url, type, sort_order))')
            .eq('id', tag.verification_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    // Fetch seller info
    const { data: seller } = await supabase
      .from('users')
      .select('username')
      .eq('id', tag.seller_id)
      .maybeSingle();

    logger.info('nfc_tag_viewed', { tagId });

    // Strip aes_key_enc from public response
    const { aes_key_enc: _omit, ...publicTag } = tag;

    return res.json({
      success: true,
      data: {
        tag: publicTag,
        events: eventsResult.data ?? [],
        nft: nftResult.data ?? null,
        verification: verificationsResult.data ?? null,
        seller: seller ?? null,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/nfc/transfer
 * Transfer ownership of an NFC-tagged item.
 */
export const transferOwnership = async (req: NfcRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: req.path });

  try {
    const userId = req.user?.id;
    if (!userId) throw new AppError('unauthenticated', 'Authentication required');

    const parsed = transferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('invalid_argument', 'Validation failed', parsed.error.issues);
    }

    const { tagId, toUserId, transferType, transactionId } = parsed.data;
    const supabase = getServiceClient();

    // Verify tag exists and user owns it (via seller_id or linked item_verification.current_owner_id)
    const { data: tag, error } = await supabase
      .from('nfc_tags')
      .select('id, seller_id, verification_id')
      .eq('id', tagId)
      .maybeSingle();

    if (error || !tag) throw new AppError('not_found', 'NFC tag not found');

    // Check ownership via verification record or seller_id
    let isOwner = tag.seller_id === userId;
    if (!isOwner && tag.verification_id) {
      const { data: verif } = await supabase
        .from('item_verifications')
        .select('current_owner_id')
        .eq('id', tag.verification_id)
        .maybeSingle();
      isOwner = verif?.current_owner_id === userId;
    }

    if (!isOwner) throw new AppError('permission_denied', 'You do not own this item');

    // Verify target user exists
    const { data: targetUser } = await supabase
      .from('users')
      .select('id')
      .eq('id', toUserId)
      .maybeSingle();

    if (!targetUser) throw new AppError('not_found', 'Target user not found');

    // Insert ownership transfer record
    const { data: transfer, error: transferError } = await supabase
      .from('ownership_transfers')
      .insert({
        verification_id: tag.verification_id,
        tag_id: tagId,
        from_user_id: userId,
        to_user_id: toUserId,
        transfer_type: transferType,
        transaction_id: transactionId ?? null,
        status: 'completed',
        transferred_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (transferError) {
      logger.error('ownership_transfer_failed', { tagId, error: transferError });
      throw new AppError('internal', 'Failed to create ownership transfer');
    }

    // Update current_owner_id on linked item_verification
    if (tag.verification_id) {
      await supabase
        .from('item_verifications')
        .update({ current_owner_id: toUserId })
        .eq('id', tag.verification_id);
    }

    logger.info('ownership_transferred', { tagId, from: userId, to: toUserId, transferType });

    return res.json({ success: true, data: transfer });
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.status).json({ success: false, error: error.message, code: error.code });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/nfc/mint
 * Stub — NFT minting integration pending Session N.
 */
export const mintNft = async (_req: NfcRequest, res: Response) => {
  return res.status(501).json({
    success: false,
    error: 'NFT minting integration pending - Session N',
  });
};
