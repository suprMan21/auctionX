import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';

const DISPUTE_REASONS = [
  { value: 'ITEM_NOT_RECEIVED',        label: 'Item not received' },
  { value: 'ITEM_NOT_AS_DESCRIBED',    label: 'Item not as described' },
  { value: 'ITEM_DAMAGED',             label: 'Item arrived damaged' },
  { value: 'COUNTERFEIT',              label: 'Suspected counterfeit / authenticity concern' },
  { value: 'OTHER',                    label: 'Other' },
] as const;

const ACCEPTED_MIME_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm,application/pdf';

const MAX_FILES = 10;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
const MIN_REASON_CHARS = 20;

interface UploadedEvidence {
  filename: string;
  url: string;
}

interface DisputeSubmissionFormProps {
  settlementId: string;
  onSubmitted: () => void;
}

export function DisputeSubmissionForm({
  settlementId,
  onSubmitted,
}: DisputeSubmissionFormProps) {
  const [reasonCategory, setReasonCategory] = useState<typeof DISPUTE_REASONS[number]['value']>('ITEM_NOT_RECEIVED');
  const [reasonText, setReasonText] = useState('');
  const [evidence, setEvidence] = useState<UploadedEvidence[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const charsRemaining = Math.max(0, MIN_REASON_CHARS - reasonText.trim().length);
  const canSubmit = reasonText.trim().length >= MIN_REASON_CHARS && !submitting && !uploading;

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (evidence.length >= MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} files per dispute`);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error('Each file must be under 50 MB');
      return;
    }

    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await api.getDisputeEvidenceUploadUrl(
        settlementId,
        file.name,
        file.type || 'application/octet-stream',
      );

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putResponse.ok) {
        throw new Error(`Upload failed (${putResponse.status})`);
      }

      setEvidence((prev) => [...prev, { filename: file.name, url: publicUrl }]);
      toast.success(`Uploaded ${file.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (index: number) => {
    setEvidence((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    const fullReason = `[${reasonCategory}] ${reasonText.trim()}`;
    setSubmitting(true);
    try {
      await api.openDispute(
        settlementId,
        fullReason,
        evidence.map((e) => e.url),
      );
      toast.success('Dispute opened. An admin will review your case.');
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="glass rounded-2xl p-6 border border-orange-500/20">
      <h2 className="text-lg font-semibold text-orange-300 mb-3">Open a Dispute</h2>
      <p className="text-gray-400 text-sm mb-4">
        If you have not received your item or there is a problem, open a dispute within the escrow window.
        Attach photos, videos, or documents that support your case — an admin will review.
      </p>

      <label htmlFor="dispute-category" className="block text-sm text-gray-300 mb-2">
        What's the issue?
      </label>
      <select
        id="dispute-category"
        value={reasonCategory}
        onChange={(e) => setReasonCategory(e.target.value as typeof reasonCategory)}
        className="w-full mb-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm px-3 py-2
                   focus:outline-none focus:ring-2 focus:ring-orange-500"
      >
        {DISPUTE_REASONS.map((r) => (
          <option key={r.value} value={r.value} className="bg-dark-800 text-white">
            {r.label}
          </option>
        ))}
      </select>

      <label htmlFor="dispute-reason" className="block text-sm text-gray-300 mb-2">
        Describe the issue <span className="text-gray-400">(min. {MIN_REASON_CHARS} characters)</span>
      </label>
      <textarea
        id="dispute-reason"
        rows={4}
        value={reasonText}
        onChange={(e) => setReasonText(e.target.value)}
        placeholder="Describe what went wrong in detail. The more context you provide, the faster we can resolve this."
        className="w-full rounded-xl bg-white/5 border border-white/10 text-white text-sm px-3 py-2
                   placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
      />
      <p className="text-xs text-gray-400 mt-1 mb-4">
        {charsRemaining > 0
          ? `${charsRemaining} more character${charsRemaining === 1 ? '' : 's'} required`
          : `${reasonText.trim().length} characters`}
      </p>

      <label className="block text-sm text-gray-300 mb-2">
        Evidence files <span className="text-gray-400">(optional, up to {MAX_FILES})</span>
      </label>
      <div className="space-y-2 mb-4">
        {evidence.map((file, index) => (
          <div
            key={`${file.url}-${index}`}
            className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2"
          >
            <span className="text-sm text-gray-300 truncate">{file.filename}</span>
            <button
              type="button"
              onClick={() => handleRemove(index)}
              className="ml-3 text-xs text-orange-300 hover:text-orange-200"
              aria-label={`Remove ${file.filename}`}
            >
              Remove
            </button>
          </div>
        ))}
        {evidence.length < MAX_FILES && (
          <label
            className={`block w-full rounded-xl border-2 border-dashed border-white/10 px-3 py-4 text-center text-sm text-gray-400 cursor-pointer hover:border-orange-500/40 hover:text-orange-300 transition-colors ${uploading ? 'opacity-60 cursor-wait' : ''}`}
          >
            <input
              type="file"
              accept={ACCEPTED_MIME_TYPES}
              onChange={handleFileSelected}
              disabled={uploading}
              className="hidden"
              data-testid="dispute-evidence-input"
            />
            {uploading ? 'Uploading…' : 'Choose file (image, video, or PDF — max 50 MB)'}
          </label>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed
                   text-white font-semibold py-3 px-6 rounded-xl transition-all"
        data-testid="dispute-submit-button"
      >
        {submitting ? 'Submitting…' : 'Open Dispute'}
      </button>
    </div>
  );
}
