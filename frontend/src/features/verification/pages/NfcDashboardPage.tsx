import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { useNfcTags } from '../hooks/useNfcTags';
import { api } from '@/lib/api';
import { registerTagFormSchema } from '../types/nfc';
import type { NfcTag } from '../types/nfc';

function TagStatusBadge({ status }: { status: NfcTag['status'] }) {
  const styles: Record<NfcTag['status'], string> = {
    registered: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
    active: 'text-green-400 bg-green-900/30 border-green-800',
    revoked: 'text-red-400 bg-red-900/30 border-red-800',
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border ${styles[status]}`}>
      {status}
    </span>
  );
}

export function NfcDashboardPage() {
  const { tags, loading, error, refetch } = useNfcTags();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [formData, setFormData] = useState({ tagUid: '', aesKey: '', itemId: '' });
  const [showAesKey, setShowAesKey] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleRegister = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setFormErrors({});
    setSubmitError(null);

    const result = registerTagFormSchema.safeParse(formData);
    if (!result.success) {
      const errors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as string;
        if (!errors[key]) errors[key] = issue.message;
      }
      setFormErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await api.nfcRegister({
        tagUid: result.data.tagUid,
        aesKey: result.data.aesKey,
        itemId: result.data.itemId || undefined,
      });
      setRegisterOpen(false);
      setFormData({ tagUid: '', aesKey: '', itemId: '' });
      refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }, [formData, refetch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading NFC tags...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-10 max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold text-white mb-3">Error</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-white">My NFC Tags</h1>
          <Button onClick={() => setRegisterOpen(true)}>Register New Tag</Button>
        </div>

        {tags.length === 0 ? (
          <div className="glass rounded-2xl p-12 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <h2 className="text-xl font-semibold text-white mb-2">No NFC Tags Yet</h2>
            <p className="text-gray-400 mb-6">Register your first NTAG 424 DNA tag to start authenticating items.</p>
            <Button onClick={() => setRegisterOpen(true)}>Register Your First Tag</Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                to={`/nfc/${tag.id}`}
                className="glass rounded-2xl p-6 hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 block"
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="font-mono text-white text-sm">{tag.tag_uid}</span>
                  <TagStatusBadge status={tag.status} />
                </div>
                <p className="text-gray-400 text-sm mb-2">
                  {tag.item_id ? 'Linked to item' : 'Unlinked'}
                </p>
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>{tag.sun_counter} scans</span>
                  <span>{new Date(tag.created_at).toLocaleDateString()}</span>
                </div>
              </Link>
            ))}
          </div>
        )}

        <Modal isOpen={registerOpen} onClose={() => setRegisterOpen(false)} title="Register NFC Tag">
          <form onSubmit={handleRegister} className="space-y-4">
            <Input
              label="Tag UID"
              placeholder="e.g. 04A1B2C3D4E5F6"
              value={formData.tagUid}
              onChange={(e) => setFormData((d) => ({ ...d, tagUid: e.target.value }))}
              error={formErrors.tagUid}
              helperText="8-14 hex characters from the NTAG 424 DNA chip"
            />
            <div className="relative">
              <Input
                label="AES Key"
                type={showAesKey ? 'text' : 'password'}
                placeholder="32 hex characters"
                value={formData.aesKey}
                onChange={(e) => setFormData((d) => ({ ...d, aesKey: e.target.value }))}
                error={formErrors.aesKey}
                helperText="The 16-byte AES key for SUN message validation"
              />
              <button
                type="button"
                onClick={() => setShowAesKey((s) => !s)}
                className="absolute right-3 top-9 text-gray-400 hover:text-white text-xs"
                aria-label={showAesKey ? 'Hide AES key' : 'Show AES key'}
              >
                {showAesKey ? 'Hide' : 'Show'}
              </button>
            </div>
            <Input
              label="Item ID (optional)"
              placeholder="UUID of the listing to link"
              value={formData.itemId}
              onChange={(e) => setFormData((d) => ({ ...d, itemId: e.target.value }))}
              error={formErrors.itemId}
              helperText="Leave empty to register an unlinked tag"
            />
            {submitError && (
              <p className="text-sm text-error-500" role="alert">{submitError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setRegisterOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Registering...' : 'Register Tag'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </div>
  );
}
