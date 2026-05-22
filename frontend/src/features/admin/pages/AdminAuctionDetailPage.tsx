import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { adminApi } from '../api/adminApi';
import type { AdminAuctionDetailData, AuctionStatus } from '../types/admin';
import { brandLabel } from '../types/admin';

const statusClass = (status: AuctionStatus): string => {
  switch (status) {
    case 'ACTIVE':
    case 'SETTLED':
      return 'bg-success-500/20 text-success-500';
    case 'ENDED':
      return 'bg-gray-500/20 text-gray-400';
    case 'CANCELLED':
      return 'bg-error-500/20 text-error-500';
    case 'DRAFT':
    case 'SCHEDULED':
    default:
      return 'bg-warning-500/20 text-warning-500';
  }
};

const formatPrice = (cents: number | null | undefined, currency: string | null | undefined): string => {
  if (cents == null) return '—';
  const dollars = cents / 100;
  return `${currency ?? 'USD'} ${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
};

export const AdminAuctionDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<AdminAuctionDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getAuctionDetail(id);
      setData(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load auction');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onEnd = async () => {
    if (!id || !data) return;
    const ok = window.confirm(
      'Force-end this auction now? Bidders will no longer be able to place bids. This is recorded in the audit log.',
    );
    if (!ok) return;
    setActing(true);
    try {
      await adminApi.endAuction(id);
      toast.success('Auction ended.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to end auction');
    } finally {
      setActing(false);
    }
  };

  const onCancel = async () => {
    if (!id || !data) return;
    const reason = window.prompt('Cancellation reason (required, logged to audit):');
    if (!reason || !reason.trim()) {
      if (reason !== null) toast.error('A reason is required to cancel.');
      return;
    }
    const ok = window.confirm(
      `Cancel this auction AND its listing? Both will move to CANCELLED state.\n\nReason: ${reason.trim()}`,
    );
    if (!ok) return;
    setActing(true);
    try {
      await adminApi.cancelAuction(id, reason.trim());
      toast.success('Auction cancelled.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel auction');
    } finally {
      setActing(false);
    }
  };

  const onRestart = async () => {
    if (!id || !data) return;
    const durationStr = window.prompt(
      'Restart this auction for how many hours? (1–720)',
      '24',
    );
    if (durationStr === null) return;
    const durationHours = Number(durationStr);
    if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 720) {
      toast.error('durationHours must be a number between 1 and 720');
      return;
    }
    const reason = window.prompt('Restart reason (required, logged to audit):');
    if (!reason || !reason.trim()) {
      if (reason !== null) toast.error('A reason is required to restart.');
      return;
    }
    const ok = window.confirm(
      `Restart this auction?\n\nThis will:\n  • clear all existing bids for this auction\n  • reset current bid to the starting price\n  • set a new end time ${durationHours}h from now\n  • re-activate the listing\n\nReason: ${reason.trim()}`,
    );
    if (!ok) return;
    setActing(true);
    try {
      await adminApi.restartAuction(id, reason.trim(), durationHours);
      toast.success('Auction restarted.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to restart auction');
    } finally {
      setActing(false);
    }
  };

  const onSettle = async () => {
    if (!id || !data) return;
    const ok = window.confirm(
      'Force-settle this ENDED auction now? This triggers the settlement Edge Function (escrow lifecycle begins). Logged to audit.',
    );
    if (!ok) return;
    setActing(true);
    try {
      await adminApi.triggerSettle(id);
      toast.success('Settlement triggered.');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to trigger settlement');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="glass rounded-2xl p-6 border border-white/10">
        <p className="text-error-500 text-sm">{error}</p>
        <Link to="/admin/auctions" className="text-primary-400 text-sm hover:text-primary-300 mt-3 inline-block">
          ← Back to auctions
        </Link>
      </div>
    );
  }
  if (!data) return null;

  const { auction, media, bids, settlement } = data;
  const listing = auction.listing;
  const seller = auction.seller;
  const status = auction.status as AuctionStatus;
  const canEnd = status === 'ACTIVE';
  const canCancel = status !== 'SETTLED' && status !== 'CANCELLED' && !settlement;
  const canSettle = status === 'ENDED';
  const canRestart = (status === 'ENDED' || status === 'CANCELLED') && !settlement;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass rounded-2xl p-6 border border-white/10">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link to="/admin/auctions" className="text-primary-400 text-sm hover:text-primary-300">
              ← Back to auctions
            </Link>
            <h1 className="text-2xl font-bold text-white mt-2 break-words">
              {listing?.title ?? 'Untitled listing'}
            </h1>
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-gray-400">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusClass(status)}`}>
                {status}
              </span>
              {listing?.brand && (
                <span className="text-gray-500">{brandLabel(listing.brand)}</span>
              )}
              {seller && (
                <Link
                  to={`/admin/users/${seller.id}`}
                  className="text-primary-400 hover:text-primary-300"
                >
                  Seller: {seller.display_name ?? seller.email ?? seller.id.slice(0, 8)}
                </Link>
              )}
              <a
                href={`/auctions/${auction.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary-400 hover:text-primary-300"
              >
                View active auction ↗
              </a>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={onEnd}
              disabled={!canEnd || acting}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-warning-500/20 text-warning-500 border border-warning-500/40 hover:bg-warning-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              End auction
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={!canCancel || acting}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-error-500/20 text-error-500 border border-error-500/40 hover:bg-error-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Cancel auction
            </button>
            <button
              type="button"
              onClick={onRestart}
              disabled={!canRestart || acting}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-primary-500/20 text-primary-300 border border-primary-500/40 hover:bg-primary-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Restart auction
            </button>
            <button
              type="button"
              onClick={onSettle}
              disabled={!canSettle || acting}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-primary-500 to-accent-500 text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              Force-settle
            </button>
          </div>
        </div>
      </div>

      {/* Listing summary */}
      <div className="glass rounded-2xl p-6 border border-white/10 space-y-4">
        <h2 className="text-lg font-semibold text-white">Listing</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <p className="text-gray-300 text-sm whitespace-pre-wrap break-words">
              {listing?.description?.trim() || <span className="text-gray-500">No description</span>}
            </p>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-gray-500 text-xs uppercase">Condition</dt>
                <dd className="text-gray-200">{listing?.condition ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs uppercase">Listing status</dt>
                <dd className="text-gray-200">{listing?.status ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs uppercase">NSFW</dt>
                <dd className="text-gray-200">{listing?.is_nsfw ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs uppercase">Location</dt>
                <dd className="text-gray-200">
                  {[listing?.location_city, listing?.location_region, listing?.location_country].filter(Boolean).join(', ') || '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs uppercase">Featured</dt>
                <dd className="text-gray-200">{listing?.is_featured ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-gray-500 text-xs uppercase">Age-gated</dt>
                <dd className="text-gray-200">{listing?.requires_age_verification ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
          </div>
          <div>
            <div className="grid grid-cols-3 lg:grid-cols-2 gap-2">
              {media.length === 0 && (
                <div className="col-span-full text-gray-500 text-sm">No media uploaded.</div>
              )}
              {media.slice(0, 6).map((m) => (
                <div key={m.id} className="aspect-square rounded-lg overflow-hidden bg-dark-700 border border-white/10">
                  <img
                    src={m.thumbnail_url ?? m.url}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Auction state */}
      <div className="glass rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold text-white mb-4">Auction state</h2>
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-gray-500 text-xs uppercase">Current bid</dt>
            <dd className="text-white text-base">{formatPrice(auction.current_price_cents, auction.currency)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">Reserve</dt>
            <dd className="text-gray-200">{formatPrice(auction.reserve_price_cents, auction.currency)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">Starting</dt>
            <dd className="text-gray-200">{formatPrice(auction.starting_price_cents, auction.currency)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">Min increment</dt>
            <dd className="text-gray-200">{formatPrice(auction.minimum_increment_cents, auction.currency)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">Start</dt>
            <dd className="text-gray-200">{formatDateTime(auction.start_time)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">End</dt>
            <dd className="text-gray-200">{formatDateTime(auction.end_time)}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">High bidder</dt>
            <dd className="text-gray-200">{auction.high_bidder?.display_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500 text-xs uppercase">Winner</dt>
            <dd className="text-gray-200">{auction.winner?.display_name ?? '—'}</dd>
          </div>
        </dl>
      </div>

      {/* Bid history */}
      <div className="glass rounded-2xl overflow-hidden border border-white/10">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Bid history</h2>
          <span className="text-gray-400 text-sm">{bids.length} {bids.length === 1 ? 'bid' : 'bids'}</span>
        </div>
        {bids.length === 0 ? (
          <div className="p-6 text-gray-400 text-sm">No bids placed yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-dark-700 border-b border-white/10">
                <tr>
                  {['Bidder', 'Amount', 'Max bid', 'Auto', 'Placed at'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {bids.map((b) => (
                  <tr key={b.id} className="bg-dark-800">
                    <td className="px-4 py-3 text-sm text-gray-200">
                      {b.bidder?.display_name ?? b.bidder_id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      {formatPrice(b.amount_cents, auction.currency)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {formatPrice(b.max_bid_cents, auction.currency)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-300">
                      {b.is_auto_bid ? 'Yes' : 'No'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {formatDateTime(b.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settlement */}
      <div className="glass rounded-2xl p-6 border border-white/10">
        <h2 className="text-lg font-semibold text-white mb-4">Settlement</h2>
        {!settlement ? (
          <p className="text-gray-400 text-sm">No settlement record for this auction.</p>
        ) : (
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 text-xs uppercase">Status</dt>
              <dd className="text-white">{settlement.status}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Gross</dt>
              <dd className="text-gray-200">{formatPrice(settlement.gross_amount_cents, auction.currency)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Net</dt>
              <dd className="text-gray-200">{formatPrice(settlement.net_amount_cents, auction.currency)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Platform fee</dt>
              <dd className="text-gray-200">{formatPrice(settlement.platform_fee_cents, auction.currency)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Escrow ends</dt>
              <dd className="text-gray-200">{formatDateTime(settlement.escrow_ends_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Released</dt>
              <dd className="text-gray-200">{formatDateTime(settlement.escrow_released_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Delivery confirmed</dt>
              <dd className="text-gray-200">{formatDateTime(settlement.delivery_confirmed_at)}</dd>
            </div>
            <div>
              <dt className="text-gray-500 text-xs uppercase">Dispute opened</dt>
              <dd className="text-gray-200">{formatDateTime(settlement.dispute_opened_at)}</dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
};
