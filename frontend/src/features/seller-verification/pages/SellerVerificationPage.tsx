import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/common/Button';
import { sellerVerificationApi } from '../api/sellerVerificationApi';
import { DocumentUploader } from '../components/DocumentUploader';
import { VerificationStatusBadge } from '../components/VerificationStatusBadge';
import type { VerificationStatusResponse, VerificationDocument, DocumentType, VerificationStatus } from '../types/sellerVerification';

const DOC_TYPES: DocumentType[] = ['government_id', 'selfie_with_id', 'proof_of_address', 'business_license'];

export const SellerVerificationPage = () => {
  const [data, setData] = useState<VerificationStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const statusData = await sellerVerificationApi.getStatus();
      setData(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load verification status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleUploadComplete = (doc: VerificationDocument) => {
    if (!data) return;
    const filtered = data.documents.filter(d => d.document_type !== doc.document_type);
    setData({ ...data, documents: [...filtered, doc] });
  };

  const handleDeleteDoc = (docId: string) => {
    if (!data) return;
    setData({ ...data, documents: data.documents.filter(d => d.id !== docId) });
  };

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await sellerVerificationApi.submit();
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading verification status...</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400">{error || 'Unable to load verification status'}</div>
      </div>
    );
  }

  const status = data.status as VerificationStatus;
  const canUpload = status === 'NONE' || status === 'REJECTED';
  const uploadedTypes = data.documents.map(d => d.document_type);
  const hasRequired = uploadedTypes.includes('government_id') && uploadedTypes.includes('selfie_with_id');

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-white">Identity Verification</h1>
          <VerificationStatusBadge status={status} size="md" />
        </div>
        <p className="text-gray-400">
          Verify your identity to start selling on the platform. Your documents are securely stored and only reviewed by our verification team.
        </p>
      </div>

      {/* Status-specific content */}
      {status === 'PENDING' && (
        <div className="glass rounded-2xl p-6 mb-6 border border-yellow-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-yellow-400 animate-pulse" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Under Review</h2>
          </div>
          <p className="text-sm text-gray-400">
            Your documents were submitted{data.submittedAt ? ` on ${new Date(data.submittedAt).toLocaleDateString()}` : ''}.
            Reviews typically take 1-2 business days.
          </p>
        </div>
      )}

      {status === 'APPROVED' && (
        <div className="glass rounded-2xl p-6 mb-6 border border-emerald-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Verified</h2>
          </div>
          <p className="text-sm text-gray-400">
            Your identity has been verified. You can now create listings and sell on the platform.
          </p>
        </div>
      )}

      {status === 'REJECTED' && data.rejectionReason && (
        <div className="glass rounded-2xl p-6 mb-6 border border-red-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white">Verification Rejected</h2>
          </div>
          <p className="text-sm text-red-400 mb-2">{data.rejectionReason}</p>
          <p className="text-sm text-gray-400">Please review the feedback above, update your documents, and resubmit.</p>
        </div>
      )}

      {status === 'REVOKED' && (
        <div className="glass rounded-2xl p-6 mb-6 border border-red-500/20">
          <h2 className="text-lg font-semibold text-white mb-2">Verification Revoked</h2>
          <p className="text-sm text-gray-400">
            Your seller verification has been revoked. Please contact support for more information.
          </p>
        </div>
      )}

      {/* Document upload section */}
      {(canUpload || status === 'PENDING') && (
        <div className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-white">Documents</h2>
          {DOC_TYPES.map(docType => {
            const existingDoc = data.documents.find(d => d.document_type === docType);
            return (
              <DocumentUploader
                key={docType}
                documentType={docType}
                existingDoc={existingDoc}
                disabled={!canUpload}
                onUploadComplete={handleUploadComplete}
                onDelete={handleDeleteDoc}
              />
            );
          })}
        </div>
      )}

      {/* Submit button */}
      {canUpload && (
        <div className="space-y-3">
          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
          <Button
            variant="primary"
            fullWidth
            disabled={!hasRequired || submitting}
            onClick={handleSubmit}
          >
            {submitting ? 'Submitting...' : 'Submit for Review'}
          </Button>
          {!hasRequired && (
            <p className="text-xs text-gray-500 text-center">
              Upload at least a government ID and selfie with ID to submit.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
