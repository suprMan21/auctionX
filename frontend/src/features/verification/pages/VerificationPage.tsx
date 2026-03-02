/**
 * VerificationPage — Public chain-of-custody page for verified items.
 *
 * Route: /verify/:tokenName (no auth required)
 * Calls: api.getVerificationByToken + api.incrementScan on mount
 * Sets document.title for SEO
 *
 * @module Module 13 — NFC Verification
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { VerificationDetail, VerificationStatus } from '../types/verification';

function StatusBadge({ status }: { status: VerificationStatus }) {
  const colors: Record<VerificationStatus, string> = {
    VERIFIED: 'text-green-400 bg-green-900/30 border-green-800',
    VIDEO_UPLOADED: 'text-blue-400 bg-blue-900/30 border-blue-800',
    NFC_PROGRAMMED: 'text-blue-400 bg-blue-900/30 border-blue-800',
    PENDING: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
    FLAGGED: 'text-red-400 bg-red-900/30 border-red-800',
    REVOKED: 'text-red-400 bg-red-900/30 border-red-800',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border ${colors[status]}`}>
      {status === 'VERIFIED' && '✓ '}
      {status.replace('_', ' ')}
    </span>
  );
}

export function VerificationPage() {
  const { tokenName } = useParams<{ tokenName: string }>();
  const [verif, setVerif] = useState<VerificationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tokenName) return;

    let mounted = true;

    api.getVerificationByToken(tokenName)
      .then((data) => {
        if (!mounted) return;
        setVerif(data);
        document.title = `${data.token_name} — Verified by @${data.seller?.username ?? 'unknown'} | AuctionX`;
        // Non-blocking scan increment
        api.incrementScan(tokenName);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Verification not found');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, [tokenName]);

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center">
        <p className="text-gray-400">Loading verification…</p>
      </div>
    );
  }

  if (error || !verif) {
    return (
      <div className="min-h-screen bg-dark-800 flex items-center justify-center px-4">
        <div className="glass rounded-2xl p-10 max-w-sm w-full text-center">
          <h1 className="text-2xl font-bold text-white mb-3">Not Found</h1>
          <p className="text-gray-400 mb-6">{error ?? 'This verification token does not exist.'}</p>
          <Link
            to="/browse"
            className="inline-block px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors"
          >
            Browse Listings
          </Link>
        </div>
      </div>
    );
  }

  const sortedMedia = verif.listing?.listing_media
    ? [...verif.listing.listing_media].sort((a, b) => a.sort_order - b.sort_order)
    : [];
  const primaryImage = sortedMedia.find((m) => m.type === 'image') ?? sortedMedia[0] ?? null;

  const sortedTransfers = [...(verif.ownership_transfers ?? [])].sort(
    (a, b) => new Date(b.transferred_at).getTime() - new Date(a.transferred_at).getTime(),
  );

  return (
    <div className="min-h-screen bg-dark-800 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-gray-400 text-sm mb-1">Verification Token</p>
            <h1 className="text-2xl font-bold text-white font-mono">{verif.token_name}</h1>
            <p className="text-gray-400 text-sm mt-1">
              by{' '}
              <span className="text-white">@{verif.seller?.username ?? verif.seller_id}</span>
            </p>
          </div>
          <StatusBadge status={verif.status} />
        </div>

        {/* ── Item Section ────────────────────────────────────────────────── */}
        {verif.listing && (
          <div className="glass rounded-2xl overflow-hidden">
            {primaryImage && (
              <img
                src={primaryImage.url}
                alt={verif.listing.title}
                className="w-full h-56 object-cover"
              />
            )}
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-2">{verif.listing.title}</h2>
              {verif.listing.description && (
                <p className="text-gray-400 text-sm leading-relaxed">{verif.listing.description}</p>
              )}
            </div>
          </div>
        )}

        {/* ── Possession-Proof Video ──────────────────────────────────────── */}
        {verif.video_url && (
          <div className="glass rounded-2xl overflow-hidden">
            <div className="px-6 pt-6 pb-3">
              <h2 className="text-lg font-semibold text-white">Possession-Proof Video</h2>
              <p className="text-gray-400 text-xs mt-1">
                Recorded by @{verif.seller?.username ?? 'seller'} · {verif.video_duration_seconds}s
              </p>
            </div>
            <video
              controls
              className="w-full"
              src={verif.video_url}
            />
          </div>
        )}

        {/* ── Ownership Timeline ──────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Chain of Custody</h2>
          {sortedTransfers.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-400 text-sm">
                Current owner:{' '}
                <span className="text-white">@{verif.current_owner?.username ?? verif.current_owner_id ?? 'original seller'}</span>
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {sortedTransfers.map((transfer) => (
                <li key={transfer.id} className="flex items-center gap-3 text-sm">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                  <span className="text-gray-300">
                    {transfer.from_user_id ? `@${transfer.from_user_id.slice(0, 8)}` : 'Original seller'}
                    {' → '}
                    @{transfer.to_user_id.slice(0, 8)}
                  </span>
                  <span className="ml-auto text-gray-500 shrink-0">
                    {new Date(transfer.transferred_at).toLocaleDateString()}
                  </span>
                  <span className="text-xs text-gray-600 bg-white/5 px-2 py-0.5 rounded-full shrink-0">
                    {transfer.transfer_type}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* ── Engagement Stats ────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Engagement</h2>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-white">{verif.scan_count}</p>
              <p className="text-gray-400 text-xs mt-0.5">Scans</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{verif.view_count}</p>
              <p className="text-gray-400 text-xs mt-0.5">Views</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{verif.share_count}</p>
              <p className="text-gray-400 text-xs mt-0.5">Shares</p>
            </div>
          </div>
        </div>

        {/* ── CTA ─────────────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              navigator.share?.({
                title: `${verif.token_name} — Verified Item`,
                url: window.location.href,
              }).catch(() => {
                navigator.clipboard.writeText(window.location.href).catch(() => {});
              });
            }}
            className="flex-1 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium transition-colors text-center"
          >
            Share
          </button>
          <Link
            to={`/browse`}
            className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold transition-colors text-center"
          >
            Browse More
          </Link>
        </div>
      </div>
    </div>
  );
}
