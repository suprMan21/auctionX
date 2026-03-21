import { Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { AuthRequest } from '../middleware/auth';
import { RequestWithId } from '../middleware/requestId';
import { AppError } from '../lib/errors';
import { withLogContext } from '../lib/logger';
import { generatePresignedUrl } from '../lib/s3';

interface VerificationRequest extends AuthRequest, RequestWithId {}

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getServiceClient() {
  return createClient(supabaseUrl, supabaseServiceKey);
}

const ALLOWED_DOC_TYPES = ['government_id', 'selfie_with_id', 'proof_of_address', 'business_license'] as const;
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * GET /api/v1/seller-verification/status
 * Returns current user's verification status and uploaded documents.
 */
export const getVerificationStatus = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/seller-verification/status' });

  try {
    if (!req.user) throw new AppError('unauthenticated', 'Not authenticated');

    const supabase = getServiceClient();
    const userId = req.user.id;

    // Fetch user verification fields
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('seller_verification_status, seller_verification_submitted_at, seller_verification_reviewed_at, seller_verification_rejection_reason')
      .eq('id', userId)
      .single();

    if (userError || !user) throw new AppError('not_found', 'User not found');

    // Fetch uploaded documents
    const { data: documents, error: docsError } = await supabase
      .from('seller_verification_documents')
      .select('id, document_type, file_url, mime_type, file_size_bytes, status, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (docsError) throw new AppError('internal', 'Failed to fetch documents');

    logger.info('verification_status_fetched', { userId, status: user.seller_verification_status });

    res.json({
      success: true,
      data: {
        status: user.seller_verification_status,
        submittedAt: user.seller_verification_submitted_at,
        reviewedAt: user.seller_verification_reviewed_at,
        rejectionReason: user.seller_verification_rejection_reason,
        documents: documents || [],
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    logger.error('verification_status_error', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/seller-verification/upload-url
 * Returns a presigned S3 PUT URL for document upload.
 * Body: { documentType, mimeType }
 */
export const getDocumentUploadUrl = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/seller-verification/upload-url' });

  try {
    if (!req.user) throw new AppError('unauthenticated', 'Not authenticated');

    const { documentType, mimeType } = req.body;

    if (!documentType || !ALLOWED_DOC_TYPES.includes(documentType)) {
      throw new AppError('invalid_argument', `Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}`);
    }

    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new AppError('invalid_argument', `Invalid mime type. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    const userId = req.user.id;
    const ext = MIME_TO_EXT[mimeType];
    const timestamp = Date.now();
    const s3Key = `seller-verification/${userId}/${documentType}-${timestamp}.${ext}`;

    const { uploadUrl, publicUrl } = await generatePresignedUrl(s3Key, mimeType);

    logger.info('document_upload_url_generated', { userId, documentType, s3Key });

    res.json({
      success: true,
      data: { uploadUrl, publicUrl, s3Key },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    logger.error('upload_url_error', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/seller-verification/documents
 * Confirms a document was uploaded to S3 and creates a DB record.
 * Body: { documentType, s3Key, fileUrl, mimeType, fileSizeBytes }
 */
export const confirmDocumentUpload = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/seller-verification/documents' });

  try {
    if (!req.user) throw new AppError('unauthenticated', 'Not authenticated');

    const { documentType, s3Key, fileUrl, mimeType, fileSizeBytes } = req.body;

    if (!documentType || !ALLOWED_DOC_TYPES.includes(documentType)) {
      throw new AppError('invalid_argument', 'Invalid document type');
    }
    if (!s3Key || !fileUrl || !mimeType) {
      throw new AppError('invalid_argument', 'Missing required fields: s3Key, fileUrl, mimeType');
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new AppError('invalid_argument', 'Invalid mime type');
    }
    if (fileSizeBytes && fileSizeBytes > MAX_FILE_SIZE) {
      throw new AppError('invalid_argument', 'File exceeds 10MB limit');
    }

    const userId = req.user.id;
    const supabase = getServiceClient();

    // Check user's current verification status — can only upload if NONE or REJECTED
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('seller_verification_status')
      .eq('id', userId)
      .single();

    if (userError || !user) throw new AppError('not_found', 'User not found');

    if (user.seller_verification_status !== 'NONE' && user.seller_verification_status !== 'REJECTED') {
      throw new AppError('failed_precondition', 'Documents can only be uploaded when status is NONE or REJECTED');
    }

    // Remove existing document of same type (replace)
    await supabase
      .from('seller_verification_documents')
      .delete()
      .eq('user_id', userId)
      .eq('document_type', documentType);

    // Insert new document record
    const { data: doc, error: insertError } = await supabase
      .from('seller_verification_documents')
      .insert({
        user_id: userId,
        document_type: documentType,
        s3_key: s3Key,
        file_url: fileUrl,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes || null,
      })
      .select('id, document_type, file_url, mime_type, file_size_bytes, status, created_at')
      .single();

    if (insertError) throw new AppError('internal', 'Failed to save document record');

    logger.info('document_upload_confirmed', { userId, documentType, docId: doc?.id });

    res.json({ success: true, data: doc });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    logger.error('document_confirm_error', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * POST /api/v1/seller-verification/submit
 * Submits verification for admin review.
 * Validates minimum required documents are uploaded.
 */
export const submitForReview = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/seller-verification/submit' });

  try {
    if (!req.user) throw new AppError('unauthenticated', 'Not authenticated');

    const userId = req.user.id;
    const supabase = getServiceClient();

    // Check current status
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('seller_verification_status')
      .eq('id', userId)
      .single();

    if (userError || !user) throw new AppError('not_found', 'User not found');

    if (user.seller_verification_status !== 'NONE' && user.seller_verification_status !== 'REJECTED') {
      throw new AppError('failed_precondition', `Cannot submit when status is ${user.seller_verification_status}`);
    }

    // Check minimum required documents
    const { data: docs, error: docsError } = await supabase
      .from('seller_verification_documents')
      .select('document_type')
      .eq('user_id', userId);

    if (docsError) throw new AppError('internal', 'Failed to check documents');

    const docTypes = (docs || []).map(d => d.document_type);
    const missingDocs: string[] = [];

    if (!docTypes.includes('government_id')) missingDocs.push('government_id');
    if (!docTypes.includes('selfie_with_id')) missingDocs.push('selfie_with_id');

    if (missingDocs.length > 0) {
      throw new AppError('failed_precondition', `Missing required documents: ${missingDocs.join(', ')}`);
    }

    // Update user status to PENDING
    const { error: updateError } = await supabase
      .from('users')
      .update({
        seller_verification_status: 'PENDING',
        seller_verification_submitted_at: new Date().toISOString(),
        seller_verification_rejection_reason: null,
      })
      .eq('id', userId);

    if (updateError) throw new AppError('internal', 'Failed to update verification status');

    logger.info('verification_submitted', { userId, documentCount: docTypes.length });

    res.json({
      success: true,
      data: { status: 'PENDING', submittedAt: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    logger.error('verification_submit_error', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};

/**
 * DELETE /api/v1/seller-verification/documents/:docId
 * Removes a document before submission. Only allowed when status is NONE or REJECTED.
 */
export const deleteDocument = async (req: VerificationRequest, res: Response) => {
  const logger = withLogContext({ requestId: req.requestId, route: '/seller-verification/documents/:docId' });

  try {
    if (!req.user) throw new AppError('unauthenticated', 'Not authenticated');

    const { docId } = req.params;
    const userId = req.user.id;
    const supabase = getServiceClient();

    // Check user status
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('seller_verification_status')
      .eq('id', userId)
      .single();

    if (userError || !user) throw new AppError('not_found', 'User not found');

    if (user.seller_verification_status !== 'NONE' && user.seller_verification_status !== 'REJECTED') {
      throw new AppError('failed_precondition', 'Documents can only be removed when status is NONE or REJECTED');
    }

    // Delete document (user can only delete their own via RLS)
    const { error: deleteError } = await supabase
      .from('seller_verification_documents')
      .delete()
      .eq('id', docId)
      .eq('user_id', userId);

    if (deleteError) throw new AppError('internal', 'Failed to delete document');

    logger.info('document_deleted', { userId, docId });

    res.json({ success: true, data: { deleted: docId } });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ success: false, error: error.message, code: error.code });
      return;
    }
    logger.error('document_delete_error', { error });
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
