import { useState, useRef } from 'react';
import { sellerVerificationApi } from '../api/sellerVerificationApi';
import type { DocumentType, VerificationDocument } from '../types/sellerVerification';
import { DOCUMENT_LABELS } from '../types/sellerVerification';

interface DocumentUploaderProps {
  documentType: DocumentType;
  existingDoc?: VerificationDocument;
  disabled?: boolean;
  onUploadComplete: (doc: VerificationDocument) => void;
  onDelete?: (docId: string) => void;
}

export const DocumentUploader = ({
  documentType,
  existingDoc,
  disabled = false,
  onUploadComplete,
  onDelete,
}: DocumentUploaderProps) => {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const config = DOCUMENT_LABELS[documentType];

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Only JPG, PNG, or PDF files are accepted');
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB');
      return;
    }

    setError(null);
    setUploading(true);
    setProgress(0);

    try {
      // 1. Get presigned URL
      const { uploadUrl, publicUrl, s3Key } = await sellerVerificationApi.getUploadUrl(documentType, file.type);
      setProgress(20);

      // 2. Upload to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });

      if (!uploadResponse.ok) throw new Error('Upload to storage failed');
      setProgress(70);

      // 3. Confirm upload in backend
      const doc = await sellerVerificationApi.confirmUpload({
        documentType,
        s3Key,
        fileUrl: publicUrl,
        mimeType: file.type,
        fileSizeBytes: file.size,
      });
      setProgress(100);

      onUploadComplete(doc);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!existingDoc || !onDelete) return;
    try {
      await sellerVerificationApi.deleteDocument(existingDoc.id);
      onDelete(existingDoc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove document');
    }
  };

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="text-sm font-semibold text-white">
            {config.label}
            {config.required && <span className="text-red-400 ml-1">*</span>}
          </h4>
          <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>
        </div>
        {existingDoc && (
          <span className="text-xs text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full">
            Uploaded
          </span>
        )}
      </div>

      {existingDoc ? (
        <div className="flex items-center gap-3 mt-3">
          {existingDoc.mime_type.startsWith('image/') ? (
            <img
              src={existingDoc.file_url}
              alt={config.label}
              className="w-16 h-16 object-cover rounded-lg border border-white/10"
            />
          ) : (
            <div className="w-16 h-16 flex items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <span className="text-xs text-gray-400">PDF</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 truncate">{existingDoc.file_url.split('/').pop()}</p>
            {existingDoc.file_size_bytes && (
              <p className="text-xs text-gray-500">
                {(existingDoc.file_size_bytes / 1024).toFixed(0)} KB
              </p>
            )}
          </div>
          {!disabled && (
            <button
              onClick={handleDelete}
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
              aria-label={`Remove ${config.label}`}
            >
              Remove
            </button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={handleFileSelect}
            disabled={disabled || uploading}
            className="hidden"
            id={`upload-${documentType}`}
            aria-label={`Upload ${config.label}`}
          />
          <label
            htmlFor={`upload-${documentType}`}
            className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed transition-all cursor-pointer
              ${disabled || uploading
                ? 'border-white/5 text-gray-600 cursor-not-allowed'
                : 'border-white/10 text-gray-400 hover:border-primary-500/50 hover:text-white hover:bg-white/5'
              }`}
          >
            {uploading ? (
              <span className="text-sm">Uploading... {progress}%</span>
            ) : (
              <span className="text-sm">Click to upload</span>
            )}
          </label>
        </div>
      )}

      {/* Progress bar */}
      {uploading && (
        <div className="mt-2 h-1 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-500 to-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400 mt-2">{error}</p>
      )}
    </div>
  );
};
