import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { useNfcTagDetail } from '../hooks/useNfcTags';
import { api } from '@/lib/api';
import type { NfcTag, VerificationEvent } from '../types/nfc';

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

function ScanTypeBadge({ type }: { type: string }) {
  const isProof = type === 'proof_upload';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${isProof ? 'bg-blue-900/30 text-blue-400 border border-blue-800' : 'bg-purple-900/30 text-purple-400 border border-purple-800'}`}>
      {type.replace('_', ' ')}
    </span>
  );
}

function CmacIndicator({ valid }: { valid: boolean | null }) {
  if (valid === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${valid ? 'text-green-400' : 'text-red-400'}`}>
      {valid ? (
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
      )}
      CMAC
    </span>
  );
}

export function NfcTagDetailPage() {
  const { tagId } = useParams<{ tagId: string }>();
  const { detail, loading, error } = useNfcTagDetail(tagId);

  const [visibleEvents, setVisibleEvents] = useState(10);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferData, setTransferData] = useState({ toUserId: '', transferType: 'sale', transactionId: '' });
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [proofFile, setProofFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [minting, setMinting] = useState(false);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintSuccess, setMintSuccess] = useState<{ txHash: string; tokenId: string } | null>(null);

  const handleTransfer = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagId) return;
    setTransferError(null);
    setTransferSubmitting(true);

    try {
      await api.nfcTransfer({
        tagId,
        toUserId: transferData.toUserId,
        transferType: transferData.transferType,
        transactionId: transferData.transactionId || undefined,
      });
      setTransferOpen(false);
      // Reload page to reflect changes
      window.location.reload();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setTransferSubmitting(false);
    }
  }, [tagId, transferData]);

  const handleProofUpload = useCallback(async () => {
    if (!proofFile || !tagId) return;
    setUploadError(null);
    setUploadProgress(0);

    try {
      const { uploadUrl } = await api.nfcUploadProof({
        tagId,
        contentType: proofFile.type,
        fileSize: proofFile.size,
      });

      // Upload to S3 via presigned URL
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      });

      await new Promise<void>((resolve, reject) => {
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', proofFile.type);
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed')));
        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(proofFile);
      });

      setUploadProgress(100);
      setProofFile(null);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setUploadProgress(null);
    }
  }, [proofFile, tagId]);

  const handleMint = useCallback(async () => {
    if (!tagId) return;
    setMintError(null);
    setMintSuccess(null);
    setMinting(true);

    try {
      const result = await api.nfcMint(tagId);
      setMintSuccess({ txHash: result.txHash, tokenId: result.tokenId });
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Minting failed');
    } finally {
      setMinting(false);
    }
  }, [tagId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading tag details...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-10 max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold text-white mb-3">Not Found</h1>
          <p className="text-gray-400 mb-6">{error ?? 'NFC tag not found.'}</p>
          <Link
            to="/nfc"
            className="inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 hover:opacity-90 text-white font-semibold transition-colors"
          >
            Back to Tags
          </Link>
        </div>
      </div>
    );
  }

  const { tag, events, nft, verification, seller } = detail;
  const shownEvents = events.slice(0, visibleEvents);
  const listing = verification?.listing;
  const primaryImage = listing?.listing_media
    ? [...listing.listing_media].sort((a, b) => a.sort_order - b.sort_order).find((m) => m.type === 'image')
    : null;

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Back link */}
        <Link to="/nfc" className="inline-flex items-center gap-1 text-gray-400 hover:text-white text-sm transition-colors">
          &larr; Back to My NFC Tags
        </Link>

        {/* Tag Header */}
        <div className="glass rounded-2xl p-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-gray-400 text-sm mb-1">NFC Tag</p>
              <h1 className="text-2xl font-bold text-white font-mono">{tag.tag_uid}</h1>
            </div>
            <TagStatusBadge status={tag.status} />
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4 text-sm">
            <div>
              <span className="text-gray-400">Seller</span>
              <p className="text-white">{seller?.display_name ?? tag.seller_id.slice(0, 8)}</p>
            </div>
            <div>
              <span className="text-gray-400">Registered</span>
              <p className="text-white">{new Date(tag.created_at).toLocaleDateString()}</p>
            </div>
            {tag.activated_at && (
              <div>
                <span className="text-gray-400">Activated</span>
                <p className="text-white">{new Date(tag.activated_at).toLocaleDateString()}</p>
              </div>
            )}
            <div>
              <span className="text-gray-400">Scan Counter</span>
              <p className="text-white">{tag.sun_counter}</p>
            </div>
          </div>
        </div>

        {/* Linked Item */}
        {listing && (
          <div className="glass rounded-2xl overflow-hidden">
            {primaryImage && (
              <img src={primaryImage.url} alt={listing.title} className="w-full h-48 object-cover" />
            )}
            <div className="p-6">
              <h2 className="text-lg font-semibold text-white mb-1">{listing.title}</h2>
              {listing.description && (
                <p className="text-gray-400 text-sm line-clamp-2">{listing.description}</p>
              )}
              {verification?.token_name && (
                <Link
                  to={`/verify/${verification.token_name}`}
                  className="inline-block mt-3 text-sm text-primary-400 hover:text-primary-300"
                >
                  View public verification page &rarr;
                </Link>
              )}
            </div>
          </div>
        )}

        {/* Scan History Timeline */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Scan History</h2>
          {events.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">No scan events yet.</p>
          ) : (
            <>
              <ol className="space-y-3">
                {shownEvents.map((event: VerificationEvent) => (
                  <li key={event.id} className="flex items-center gap-3 text-sm">
                    <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                    <span className="text-gray-400 shrink-0 w-28">
                      {new Date(event.created_at).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                    <ScanTypeBadge type={event.scan_type} />
                    <CmacIndicator valid={event.cmac_valid} />
                    {event.sun_counter_value !== null && (
                      <span className="ml-auto text-xs text-gray-500">#{event.sun_counter_value}</span>
                    )}
                  </li>
                ))}
              </ol>
              {events.length > visibleEvents && (
                <button
                  type="button"
                  onClick={() => setVisibleEvents((v) => v + 10)}
                  className="mt-4 w-full py-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
                >
                  Load more ({events.length - visibleEvents} remaining)
                </button>
              )}
            </>
          )}
        </div>

        {/* NFT Section */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">NFT Certificate</h2>
          {nft ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Chain</span>
                <span className="text-white">{nft.chain}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Token ID</span>
                <span className="text-white font-mono">{nft.token_id}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Contract</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(nft.contract_address).catch(() => {})}
                  className="text-white font-mono text-xs hover:text-primary-400 transition-colors"
                  title={nft.contract_address}
                >
                  {nft.contract_address.slice(0, 6)}...{nft.contract_address.slice(-4)}
                </button>
              </div>
              {nft.mint_tx_hash && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Mint TX</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(nft.mint_tx_hash!).catch(() => {})}
                    className="text-white font-mono text-xs hover:text-primary-400 transition-colors"
                    title={nft.mint_tx_hash}
                  >
                    {nft.mint_tx_hash.slice(0, 6)}...{nft.mint_tx_hash.slice(-4)}
                  </button>
                </div>
              )}
              {nft.minted_at && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Minted</span>
                  <span className="text-white">{new Date(nft.minted_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 space-y-3">
              <p className="text-gray-400 text-sm">Not yet minted</p>
              {mintSuccess ? (
                <div className="text-left space-y-2">
                  <p className="text-green-400 text-sm font-semibold">NFT minted successfully!</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Token ID</span>
                    <span className="text-white font-mono">{mintSuccess.tokenId}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">TX Hash</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(mintSuccess.txHash).catch(() => {})}
                      className="text-white font-mono text-xs hover:text-primary-400 transition-colors"
                    >
                      {mintSuccess.txHash.slice(0, 10)}...{mintSuccess.txHash.slice(-6)}
                    </button>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                    Refresh to view NFT
                  </Button>
                </div>
              ) : (
                <>
                  <Button onClick={handleMint} disabled={minting}>
                    {minting ? 'Minting...' : 'Mint NFT Certificate'}
                  </Button>
                  {mintError && (
                    <p className="text-error-500 text-sm" role="alert">{mintError}</p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Video Proof Upload */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Video Proof</h2>
          <div className="space-y-3">
            <label htmlFor="proof-upload" className="block text-sm text-gray-400">
              Upload a video showing the NFC tag on the physical item
            </label>
            <input
              id="proof-upload"
              type="file"
              accept="video/*"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-white/10 file:text-white hover:file:bg-white/20"
            />
            {proofFile && (
              <div className="flex items-center gap-3">
                <Button size="sm" onClick={handleProofUpload} disabled={uploadProgress !== null && uploadProgress < 100}>
                  Upload
                </Button>
                <span className="text-xs text-gray-400">{proofFile.name}</span>
              </div>
            )}
            {uploadProgress !== null && (
              <div className="w-full bg-dark-600 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-primary-500 to-accent-500 h-2 rounded-full transition-all"
                  style={{ width: `${uploadProgress}%` }}
                  role="progressbar"
                  aria-valuenow={uploadProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            )}
            {uploadProgress === 100 && (
              <p className="text-green-400 text-sm">Upload complete!</p>
            )}
            {uploadError && (
              <p className="text-error-500 text-sm" role="alert">{uploadError}</p>
            )}
          </div>
        </div>

        {/* Transfer Ownership */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Transfer Ownership</h2>
          <p className="text-gray-400 text-sm mb-4">Transfer this NFC-tagged item to another user.</p>
          <Button variant="secondary" onClick={() => setTransferOpen(true)}>
            Transfer Ownership
          </Button>
        </div>

        <Modal isOpen={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer Ownership">
          <form onSubmit={handleTransfer} className="space-y-4">
            <Input
              label="Recipient User ID"
              placeholder="UUID of the new owner"
              value={transferData.toUserId}
              onChange={(e) => setTransferData((d) => ({ ...d, toUserId: e.target.value }))}
            />
            <div>
              <label htmlFor="transfer-type" className="block text-sm font-medium text-gray-300 mb-2">
                Transfer Type
              </label>
              <select
                id="transfer-type"
                value={transferData.transferType}
                onChange={(e) => setTransferData((d) => ({ ...d, transferType: e.target.value }))}
                className="w-full min-h-[44px] px-4 py-3 rounded-xl bg-dark-600 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
              >
                <option value="sale">Sale</option>
                <option value="gift">Gift</option>
                <option value="return">Return</option>
              </select>
            </div>
            <Input
              label="Transaction ID (optional)"
              placeholder="UUID of the related transaction"
              value={transferData.transactionId}
              onChange={(e) => setTransferData((d) => ({ ...d, transactionId: e.target.value }))}
            />
            {transferError && (
              <p className="text-sm text-error-500" role="alert">{transferError}</p>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setTransferOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={transferSubmitting}>
                {transferSubmitting ? 'Transferring...' : 'Confirm Transfer'}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </div>
  );
}
