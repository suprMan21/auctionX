/**
 * AdminReissuePage (S-ADMIN1 Ph2) — the re-issue queue.
 *
 * A re-issue replaces a chip that is coming loose, before it falls off, for the
 * registered owner. Each request carries a live tap of the old chip and 1–3
 * photos from the web camera. Flow: Pending → approve (owner pays on the
 * website) or approve without fee → Ready for a chip → Fulfil. Nothing is
 * fulfilled unpaid.
 *
 * Photos are 5-minute signed links; reloading the page refreshes them.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, chipLabel, type AdminReissueFilter, type AdminReissueRequest } from '../api/adminApi';
import { AdminLifecycleBadge } from '../components/AdminLifecycleBadge';
import {
  AdminReissueFulfilDialog,
  AdminReissueReviewDialog,
  type ReissueDecision,
} from '../components/AdminReissueDialogs';

const FILTERS: ReadonlyArray<{ label: string; value: AdminReissueFilter }> = [
  { label: 'Pending review', value: 'PENDING' },
  { label: 'Awaiting payment', value: 'AWAITING_PAYMENT' },
  { label: 'Ready for a chip', value: 'READY' },
  { label: 'Done', value: 'DONE' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'All', value: 'ALL' },
];

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
const shortId = (id: string | null): string => (id ? `${id.slice(0, 8)}…` : '—');
const money = (amount: number | null, currency: string | null): string =>
  amount === null ? '—' : `${(amount / 100).toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`;

const stageOf = (r: AdminReissueRequest): string => {
  if (r.fulfilledAt) return 'Done';
  if (r.status === 'PENDING') return 'Pending review';
  if (r.status === 'APPROVED' && r.paymentStatus === 'AWAITING_PAYMENT') return 'Awaiting payment';
  if (r.status === 'APPROVED' && r.paymentStatus === 'PAID') return 'Paid, ready for a chip';
  if (r.status === 'APPROVED' && r.paymentStatus === 'WAIVED') return 'Fee waived, ready for a chip';
  return r.status.charAt(0) + r.status.slice(1).toLowerCase();
};

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'review'; request: AdminReissueRequest; decision: ReissueDecision }
  | { kind: 'fulfil'; request: AdminReissueRequest };

export const AdminReissuePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  const filter: AdminReissueFilter = FILTERS.some((f) => f.value === raw) ? (raw as AdminReissueFilter) : 'PENDING';

  const [reloadKey, setReloadKey] = useState(0);
  const queryKey = `${filter}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; rows: AdminReissueRequest[]; total: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listReissueRequests({ status: filter, limit: 50 })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, rows: res.data.requests, total: res.data.pagination.total });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: err instanceof Error ? err.message : 'Failed to load the queue' });
      });
    return () => { cancelled = true; };
  }, [filter, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];

  const closeAndReload = () => {
    setDialog({ kind: 'none' });
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Re-issue queue</h1>
        <p className="text-gray-400 text-sm mt-1">
          Replacement chips for owners whose chip is coming loose. Approve only when the photos show the chip still
          attached to the item.
        </p>
      </div>

      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by stage">
        {FILTERS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={filter === opt.value}
            onClick={() => setSearchParams({ status: opt.value })}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
              focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
              ${filter === opt.value
                ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                : 'bg-dark-700 text-gray-400 hover:text-white hover:bg-dark-600'}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48" role="status" aria-label="Loading the re-issue queue">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p role="alert" className="text-red-400 text-sm">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">No requests at this stage.</p>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Re-issue requests">
          {rows.map((r) => (
            <li key={r.id} className="glass rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-white font-semibold">
                    <Link
                      to={`/admin/tags/${r.tagId}`}
                      className="font-mono text-primary-300 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      {r.tag ? chipLabel(r.tag) : shortId(r.tagId)}
                    </Link>
                  </h2>
                  <p className="text-sm text-gray-400">{stageOf(r)}</p>
                </div>
                {r.tag && <AdminLifecycleBadge status={r.tag.lifecycleStatus} />}
              </div>

              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="inline text-gray-400">Requester: </dt><dd className="inline font-mono text-gray-200">{shortId(r.requesterAccountId)}</dd></div>
                <div><dt className="inline text-gray-400">Requested: </dt><dd className="inline text-gray-200">{fmt(r.createdAt)}</dd></div>
                <div><dt className="inline text-gray-400">Proof tap: </dt><dd className="inline text-gray-200">{fmt(r.tappedAt)}</dd></div>
                <div><dt className="inline text-gray-400">Fee: </dt><dd className="inline text-gray-200">{r.paymentStatus === 'WAIVED' ? 'Waived' : money(r.chargedAmount, r.chargedCurrency)}</dd></div>
                {r.paidAt && <div><dt className="inline text-gray-400">Paid: </dt><dd className="inline text-gray-200">{fmt(r.paidAt)}</dd></div>}
                {r.reviewReason && <div className="sm:col-span-2"><dt className="inline text-gray-400">Review reason: </dt><dd className="inline text-gray-200">{r.reviewReason}</dd></div>}
                {r.fulfilledAt && r.newTagId && (
                  <div className="sm:col-span-2">
                    <dt className="inline text-gray-400">New chip: </dt>
                    <dd className="inline"><Link to={`/admin/tags/${r.newTagId}`} className="font-mono text-primary-300 hover:underline">{shortId(r.newTagId)}</Link></dd>
                  </div>
                )}
              </dl>

              {r.tag && !r.tag.requesterStillOwner && !r.fulfilledAt && r.status !== 'REJECTED' && r.status !== 'CANCELLED' && (
                <p role="note" className="text-sm text-amber-300">The requester no longer owns this token.</p>
              )}

              {r.photoUrls.length > 0 ? (
                <div className="flex flex-wrap gap-3">
                  {r.photoUrls.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block rounded-xl overflow-hidden border border-white/10 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                      <img
                        src={url}
                        alt={`Photo ${i + 1} of ${r.photoUrls.length} of the chip on the item`}
                        className="h-32 w-32 object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  ))}
                </div>
              ) : r.photoCount > 0 ? (
                <p className="text-xs text-gray-500">{r.photoCount} photo{r.photoCount === 1 ? '' : 's'} on file.</p>
              ) : null}

              {r.status === 'PENDING' && (
                <div className="flex flex-wrap gap-2">
                  <ActionButton onClick={() => setDialog({ kind: 'review', request: r, decision: 'approve' })} tone="primary">
                    Approve…
                  </ActionButton>
                  <ActionButton onClick={() => setDialog({ kind: 'review', request: r, decision: 'approve_waived' })}>
                    Approve without fee…
                  </ActionButton>
                  <ActionButton onClick={() => setDialog({ kind: 'review', request: r, decision: 'reject' })} tone="danger">
                    Reject…
                  </ActionButton>
                </div>
              )}
              {r.status === 'APPROVED' && !r.fulfilledAt && (r.paymentStatus === 'PAID' || r.paymentStatus === 'WAIVED') && (
                <ActionButton onClick={() => setDialog({ kind: 'fulfil', request: r })} tone="danger">
                  Fulfil with a new chip…
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
      )}

      {dialog.kind === 'review' && (
        <AdminReissueReviewDialog
          open
          request={dialog.request}
          decision={dialog.decision}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={closeAndReload}
        />
      )}
      {dialog.kind === 'fulfil' && (
        <AdminReissueFulfilDialog
          open
          request={dialog.request}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={(newTagId) => {
            setDialog({ kind: 'none' });
            navigate(`/admin/tags/${newTagId}`);
          }}
        />
      )}
    </div>
  );
};

const ActionButton = (
  { onClick, tone, children }:
  { onClick: () => void; tone?: 'primary' | 'danger'; children: React.ReactNode },
) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-2 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary-500
      focus:ring-offset-2 focus:ring-offset-dark-800
      ${tone === 'primary' ? 'bg-primary-600 text-white hover:bg-primary-500'
        : tone === 'danger' ? 'bg-red-600/20 text-red-300 border border-red-500/30 hover:bg-red-600/30'
        : 'bg-dark-700 text-gray-200 hover:bg-dark-600'}`}
  >
    {children}
  </button>
);
