import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { z } from 'zod';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { useNfcTagDetail } from '../hooks/useNfcTags';
import { api } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { NfcTag, VerificationEvent } from '../types/nfc';

const uuidSchema = z.string().uuid('Must be a valid UUID');
const transferTypeSchema = z.enum(['sale', 'gift', 'return']);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

/**
 * Confirm a video proof upload. The api.ts client does not currently expose this
 * endpoint, but the backend route POST /nfc/proof/confirm requires { proofId }
 * (returned by /nfc/proof — not currently in the api.ts type signature).
 * We call it inline here; if the call fails, the verification_event row stays
 * in `pending` status, which is acceptable for MVP — the proof video itself
 * is already in S3.
 */
async function confirmProofRaw(proofId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  const res = await fetch(`${API_URL}/nfc/proof/confirm`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proofId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || 'Failed to confirm proof');
  }
}

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

  // ── Transfer modal state ───────────────────────────────────────────────
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferStep, setTransferStep] = useState<'form' | 'confirm'>('form');
  const [transferData, setTransferData] = useState({ toUserId: '', transferType: 'sale', transactionId: '' });
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const transferTriggerRef = useRef<HTMLDivElement>(null);

  // ── Proof upload state (MediaRecorder capture) ─────────────────────────
  const captureVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const proofStreamRef = useRef<MediaStream | null>(null);
  const proofChunksRef = useRef<Blob[]>([]);
  const recordStartRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [captureMode, setCaptureMode] = useState<'idle' | 'previewing' | 'recording' | 'review' | 'uploading' | 'success'>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [proofPermissionError, setProofPermissionError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [proofUploadCtx, setProofUploadCtx] = useState<{ uploadUrl: string; proofId: string; contentType: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // ── Mint state ─────────────────────────────────────────────────────────
  const [mintConfirmOpen, setMintConfirmOpen] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintStage, setMintStage] = useState<'pinning' | 'minting' | null>(null);
  const [mintError, setMintError] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<
    | { txHash: string; tokenId: string; metadataUri: string; chain: string; contractAddress: string }
    | null
  >(null);

  const resetTransfer = useCallback(() => {
    setTransferOpen(false);
    setTransferStep('form');
    setTransferError(null);
    setTransferSubmitting(false);
    // Return focus to the trigger button (rendered as a wrapper div around <Button>).
    transferTriggerRef.current?.querySelector('button')?.focus();
  }, []);

  const handleTransferReview = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);

    const recipientCheck = uuidSchema.safeParse(transferData.toUserId.trim());
    if (!recipientCheck.success) {
      setTransferError(recipientCheck.error.issues[0]?.message ?? 'Invalid recipient UUID');
      return;
    }
    const typeCheck = transferTypeSchema.safeParse(transferData.transferType);
    if (!typeCheck.success) {
      setTransferError('Invalid transfer type');
      return;
    }
    if (transferData.transferType === 'sale' && transferData.transactionId.trim()) {
      const txnCheck = uuidSchema.safeParse(transferData.transactionId.trim());
      if (!txnCheck.success) {
        setTransferError('Transaction ID must be a valid UUID (or leave it blank)');
        return;
      }
    }
    setTransferStep('confirm');
  }, [transferData]);

  const handleTransferConfirm = useCallback(async () => {
    if (!tagId) return;
    setTransferError(null);
    setTransferSubmitting(true);

    try {
      await api.nfcTransfer({
        tagId,
        toUserId: transferData.toUserId.trim(),
        transferType: transferData.transferType,
        transactionId: transferData.transferType === 'sale' && transferData.transactionId.trim()
          ? transferData.transactionId.trim()
          : undefined,
      });
      toast.success('Ownership transferred');
      resetTransfer();
      // No refresh exposed by useNfcTagDetail; reload to reflect new owner.
      window.location.reload();
    } catch (err) {
      setTransferError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setTransferSubmitting(false);
    }
  }, [tagId, transferData, resetTransfer]);

  // ── Proof video capture ─────────────────────────────────────────────────
  const stopProofStream = useCallback(() => {
    proofStreamRef.current?.getTracks().forEach((t) => t.stop());
    proofStreamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setProofPermissionError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      proofStreamRef.current = stream;
      if (captureVideoRef.current) {
        captureVideoRef.current.srcObject = stream;
      }
      setCaptureMode('previewing');
    } catch (err) {
      setProofPermissionError(
        err instanceof Error
          ? `Camera unavailable: ${err.message}. Please grant camera permission in your browser settings.`
          : 'Camera unavailable. Please grant camera permission.',
      );
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!proofStreamRef.current) return;
    proofChunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
    const mr = new MediaRecorder(proofStreamRef.current, { mimeType });
    mediaRecorderRef.current = mr;

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) proofChunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const duration = (Date.now() - recordStartRef.current) / 1000;
      setRecordedDuration(Math.round(duration));
      const blob = new Blob(proofChunksRef.current, { type: mimeType });
      setRecordedBlob(blob);
      if (previewVideoRef.current) {
        previewVideoRef.current.src = URL.createObjectURL(blob);
      }
      stopProofStream();
      setCaptureMode('review');
    };

    recordStartRef.current = Date.now();
    setElapsed(0);
    mr.start(500);
    setCaptureMode('recording');

    tickRef.current = setInterval(() => {
      const e = (Date.now() - recordStartRef.current) / 1000;
      setElapsed(Math.floor(e));
      if (e >= 30) {
        if (tickRef.current) clearInterval(tickRef.current);
        mediaRecorderRef.current?.stop();
      }
    }, 250);
  }, [stopProofStream]);

  const stopRecording = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    mediaRecorderRef.current?.stop();
  }, []);

  const retakeRecording = useCallback(() => {
    setRecordedBlob(null);
    setRecordedDuration(0);
    setElapsed(0);
    setUploadError(null);
    setProofUploadCtx(null);
    void startCamera();
  }, [startCamera]);

  const performS3Upload = useCallback(async (uploadUrl: string, blob: Blob, contentType: string) => {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': contentType },
    });
    if (!res.ok) throw new Error(`S3 upload failed (${res.status})`);
  }, []);

  const handleProofUpload = useCallback(async () => {
    if (!recordedBlob || !tagId) return;
    setUploadError(null);
    setUploading(true);
    setCaptureMode('uploading');

    try {
      // Step 1 — request presigned URL (only if we don't already have one).
      let ctx = proofUploadCtx;
      if (!ctx) {
        const resp = (await api.nfcUploadProof({
          tagId,
          contentType: recordedBlob.type,
          fileSize: recordedBlob.size,
        })) as unknown as { uploadUrl: string; publicUrl: string; videoKey: string; proofId?: string };
        if (!resp.proofId) {
          // proofId is needed by /nfc/proof/confirm; backend returns it but
          // it is not in the api.ts TypeScript signature.
          throw new Error('Server did not return a proof ID');
        }
        ctx = { uploadUrl: resp.uploadUrl, proofId: resp.proofId, contentType: recordedBlob.type };
        setProofUploadCtx(ctx);
      }

      // Step 2 — PUT to S3.
      await performS3Upload(ctx.uploadUrl, recordedBlob, ctx.contentType);

      // Step 3 — confirm.
      try {
        await confirmProofRaw(ctx.proofId);
      } catch (confirmErr) {
        // Non-fatal: the video is in S3; row remains pending. Log and continue.
        // eslint-disable-next-line no-console
        console.warn('Proof confirm failed (non-fatal):', confirmErr);
      }

      setCaptureMode('success');
      setProofUploadCtx(null);
      toast.success('Proof video uploaded');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setCaptureMode('review');
    } finally {
      setUploading(false);
    }
  }, [recordedBlob, tagId, proofUploadCtx, performS3Upload]);

  const retryS3Upload = useCallback(async () => {
    if (!recordedBlob || !proofUploadCtx) return;
    setUploadError(null);
    setUploading(true);
    setCaptureMode('uploading');
    try {
      await performS3Upload(proofUploadCtx.uploadUrl, recordedBlob, proofUploadCtx.contentType);
      try {
        await confirmProofRaw(proofUploadCtx.proofId);
      } catch (confirmErr) {
        // eslint-disable-next-line no-console
        console.warn('Proof confirm failed (non-fatal):', confirmErr);
      }
      setCaptureMode('success');
      setProofUploadCtx(null);
      toast.success('Proof video uploaded');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
      setCaptureMode('review');
    } finally {
      setUploading(false);
    }
  }, [recordedBlob, proofUploadCtx, performS3Upload]);

  // Cleanup camera on unmount.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    stopProofStream();
  }, [stopProofStream]);

  // ── Mint flow ───────────────────────────────────────────────────────────
  const handleMintConfirm = useCallback(async () => {
    if (!tagId) return;
    setMintError(null);
    setMintResult(null);
    setMinting(true);
    setMintStage('pinning');

    try {
      // Optimistic UX: switch stage halfway through. The backend pins to IPFS
      // first then submits the on-chain transaction; we don't get progress
      // events so we just flip the label after a short delay.
      const stageTimer = setTimeout(() => setMintStage('minting'), 1500);
      const result = await api.nfcMint(tagId);
      clearTimeout(stageTimer);
      setMintResult({
        txHash: result.txHash,
        tokenId: result.tokenId,
        metadataUri: result.metadataUri,
        chain: result.chain,
        contractAddress: result.contractAddress,
      });
      setMintConfirmOpen(false);
      toast.success('NFT minted');
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Minting failed');
    } finally {
      setMinting(false);
      setMintStage(null);
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

  // Mint eligibility: verification must be VERIFIED and no NFT minted yet.
  const mintEligible = !nft && verification?.status === 'VERIFIED';
  const baseScanUrl = (txHash: string) => `https://basescan.org/tx/${txHash}`;

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
              {mintResult ? (
                <div className="text-left space-y-2">
                  <p className="text-green-400 text-sm font-semibold">NFT minted successfully!</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Chain</span>
                    <span className="text-white">{mintResult.chain}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Token ID</span>
                    <span className="text-white font-mono">{mintResult.tokenId}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Contract</span>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(mintResult.contractAddress).catch(() => {})}
                      className="text-white font-mono text-xs hover:text-primary-400 transition-colors"
                      title={mintResult.contractAddress}
                    >
                      {mintResult.contractAddress.slice(0, 6)}...{mintResult.contractAddress.slice(-4)}
                    </button>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">TX Hash</span>
                    <a
                      href={baseScanUrl(mintResult.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-400 hover:text-primary-300 font-mono text-xs underline"
                    >
                      {mintResult.txHash.slice(0, 10)}...{mintResult.txHash.slice(-6)}
                    </a>
                  </div>
                  {mintResult.metadataUri && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Metadata</span>
                      <a
                        href={mintResult.metadataUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-400 hover:text-primary-300 text-xs underline truncate max-w-[60%]"
                      >
                        IPFS
                      </a>
                    </div>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                    Refresh to view NFT
                  </Button>
                </div>
              ) : mintEligible ? (
                <>
                  <p className="text-gray-400 text-sm">Not yet minted</p>
                  <Button onClick={() => setMintConfirmOpen(true)} disabled={minting}>
                    Mint NFT Certificate
                  </Button>
                  {mintError && (
                    <p className="text-error-500 text-sm" role="alert">{mintError}</p>
                  )}
                </>
              ) : (
                <p className="text-gray-400 text-sm">
                  {!verification
                    ? 'Link this tag to a verified item before minting an NFT certificate.'
                    : verification.status !== 'VERIFIED'
                      ? `Item must be VERIFIED before minting (current status: ${verification.status}).`
                      : 'NFT certificate has already been minted.'}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Video Proof Upload */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Video Proof</h2>
          <p className="text-gray-400 text-sm mb-4">
            Record a 15–30 second video showing the NFC tag on the physical item.
          </p>

          {captureMode === 'idle' && (
            <div className="space-y-3">
              {proofPermissionError && (
                <p className="text-red-400 text-sm" role="alert">{proofPermissionError}</p>
              )}
              <Button onClick={startCamera}>Start Camera</Button>
            </div>
          )}

          {(captureMode === 'previewing' || captureMode === 'recording') && (
            <div className="space-y-3">
              <div className="relative rounded-xl overflow-hidden bg-black">
                <video
                  ref={captureVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-64 object-cover"
                />
                {captureMode === 'recording' && (
                  <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 rounded-full px-3 py-1">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-white text-sm font-mono">{elapsed}s / 30s</span>
                  </div>
                )}
              </div>
              {captureMode === 'previewing' ? (
                <Button onClick={startRecording} className="w-full">Start Recording</Button>
              ) : (
                <Button
                  onClick={stopRecording}
                  disabled={elapsed < 15}
                  className="w-full"
                >
                  {elapsed < 15 ? `Hold for ${15 - elapsed}s more…` : 'Stop Recording'}
                </Button>
              )}
            </div>
          )}

          {captureMode === 'review' && recordedBlob && (
            <div className="space-y-3">
              <p className="text-green-400 text-sm">
                Recorded {recordedDuration}s
                {recordedDuration < 15 && ' — needs at least 15 seconds'}
              </p>
              <video ref={previewVideoRef} controls className="w-full rounded-xl" />
              {uploadError && (
                <p className="text-red-400 text-sm" role="alert">{uploadError}</p>
              )}
              <div className="flex gap-3">
                <Button variant="secondary" onClick={retakeRecording} disabled={uploading}>
                  Retake
                </Button>
                {proofUploadCtx && uploadError ? (
                  <Button onClick={retryS3Upload} disabled={uploading}>
                    {uploading ? 'Retrying…' : 'Retry Upload'}
                  </Button>
                ) : (
                  <Button onClick={handleProofUpload} disabled={uploading || recordedDuration < 15}>
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                )}
              </div>
            </div>
          )}

          {captureMode === 'uploading' && (
            <div className="space-y-3 text-center py-2">
              <div className="inline-block w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">
                Uploading {recordedBlob ? `${Math.round(recordedBlob.size / 1024)} KB` : ''}…
              </p>
            </div>
          )}

          {captureMode === 'success' && (
            <div className="text-center py-2 space-y-3">
              <p className="text-green-400 font-semibold">Proof video uploaded.</p>
              <Button variant="secondary" size="sm" onClick={retakeRecording}>
                Record Another
              </Button>
            </div>
          )}
        </div>

        {/* Transfer Ownership */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Transfer Ownership</h2>
          <p className="text-gray-400 text-sm mb-4">Transfer this NFC-tagged item to another user.</p>
          <div ref={transferTriggerRef} className="inline-block">
            <Button
              variant="secondary"
              onClick={() => setTransferOpen(true)}
            >
              Transfer Ownership
            </Button>
          </div>
        </div>

        {/* ── Transfer Modal (form -> confirm) ──────────────────────────── */}
        <Modal isOpen={transferOpen} onClose={resetTransfer} title="Transfer Ownership">
          {transferStep === 'form' ? (
            <form onSubmit={handleTransferReview} className="space-y-4">
              <Input
                label="Recipient User ID"
                placeholder="UUID of the new owner"
                value={transferData.toUserId}
                onChange={(e) => setTransferData((d) => ({ ...d, toUserId: e.target.value }))}
                helperText="Enter the recipient's account UUID."
                autoFocus
              />
              <fieldset>
                <legend className="block text-sm font-medium text-gray-300 mb-2">
                  Transfer Type
                </legend>
                <div className="grid grid-cols-3 gap-2" role="radiogroup">
                  {(['sale', 'gift', 'return'] as const).map((t) => {
                    const selected = transferData.transferType === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setTransferData((d) => ({ ...d, transferType: t }))}
                        className={`min-h-[44px] px-3 py-2 rounded-xl text-sm font-medium capitalize transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800 ${
                          selected
                            ? 'bg-gradient-to-r from-primary-500 to-accent-500 text-white border border-white/10'
                            : 'glass text-gray-300 hover:bg-white/[0.07]'
                        }`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {transferData.transferType === 'sale' && (
                <Input
                  label="Settlement / Transaction ID (optional)"
                  placeholder="UUID of the related settlement"
                  value={transferData.transactionId}
                  onChange={(e) => setTransferData((d) => ({ ...d, transactionId: e.target.value }))}
                  helperText="Leave blank if not tied to a settlement record."
                />
              )}
              {transferError && (
                <p className="text-sm text-error-500" role="alert">{transferError}</p>
              )}
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={resetTransfer}>
                  Cancel
                </Button>
                <Button type="submit">
                  Review
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="glass rounded-xl p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">From</span>
                  <span className="text-white">{seller?.display_name ?? tag.seller_id.slice(0, 8)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">To</span>
                  <span className="text-white font-mono text-xs">{transferData.toUserId.trim()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Type</span>
                  <span className="text-white capitalize">{transferData.transferType}</span>
                </div>
                {transferData.transferType === 'sale' && transferData.transactionId.trim() && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Settlement</span>
                    <span className="text-white font-mono text-xs">{transferData.transactionId.trim()}</span>
                  </div>
                )}
              </div>
              <p className="text-gray-400 text-sm">
                This action will transfer ownership and is recorded in the chain of custody.
              </p>
              {transferError && (
                <p className="text-sm text-error-500" role="alert">{transferError}</p>
              )}
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="secondary" onClick={() => setTransferStep('form')} disabled={transferSubmitting}>
                  Back
                </Button>
                <Button type="button" onClick={handleTransferConfirm} disabled={transferSubmitting}>
                  {transferSubmitting ? 'Transferring…' : 'Confirm Transfer'}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* ── Mint Confirmation Modal ────────────────────────────────────── */}
        <Modal
          isOpen={mintConfirmOpen}
          onClose={() => { if (!minting) setMintConfirmOpen(false); }}
          title="Mint NFT Certificate"
        >
          <div className="space-y-4">
            {minting ? (
              <div className="text-center py-4 space-y-3">
                <div className="inline-block w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
                <p className="text-white">
                  {mintStage === 'pinning' ? 'Pinning metadata to IPFS…' : 'Minting on Base…'}
                </p>
                <p className="text-gray-400 text-xs">This can take up to a minute.</p>
              </div>
            ) : (
              <>
                <p className="text-gray-300 text-sm">
                  Mint an NFT certificate on Base for this tag? This is irreversible —
                  metadata will be pinned to IPFS and a token will be minted on-chain.
                </p>
                {mintError && (
                  <p className="text-sm text-error-500" role="alert">{mintError}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <Button type="button" variant="secondary" onClick={() => setMintConfirmOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={handleMintConfirm}>
                    Confirm Mint
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      </div>
    </div>
  );
}
