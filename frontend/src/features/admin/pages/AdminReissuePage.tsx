/**
 * AdminReissuePage (S-ADMIN1 Ph2) — the re-issue queue.
 *
 * A re-issue replaces a chip that is coming loose, before it falls off, for the
 * registered owner. Each request carries a live tap of the old chip and 1–3
 * photos from the web camera. Flow: Pending → approve (owner pays on the
 * website) or approve without fee → Ready for a chip → Move token to new chip
 * (the API calls this step "fulfil"). Nothing is completed unpaid.
 *
 * Photos are 5-minute signed links; reloading the page refreshes them.
 */

import { useWorkQueues } from '../lib/workQueues';
import { useEffect, useState } from 'react';
import { AccountLink } from '../components/AccountLink';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, chipLabel, type AdminReissueFilter, type AdminReissueRequest } from '../api/adminApi';
import { AdminLifecycleBadge } from '../components/AdminLifecycleBadge';
import {
  AdminReissueFulfilDialog,
  AdminReissueReviewDialog,
  type ReissueDecision,
} from '../components/AdminReissueDialogs';
import { errorMessage, formatAmount, formatWhen as fmt, loadFailed, shortId } from '../lib/display';
import { reissueStageLabel } from '../lib/labels';
import { AdminPagination, FilterPills, ListState } from '../components/AdminListParts';

const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FILTERS: ReadonlyArray<{ label: string; value: AdminReissueFilter }> = [
  { label: 'Needs action', value: 'NEEDS_ACTION' },
  { label: 'Waiting for review', value: 'PENDING' },
  { label: 'Waiting for payment', value: 'AWAITING_PAYMENT' },
  { label: 'Ready for a new chip', value: 'READY' },
  { label: 'Done', value: 'DONE' },
  { label: 'Rejected', value: 'REJECTED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'All', value: 'ALL' },
];

const stageOf = (r: AdminReissueRequest): string => reissueStageLabel(r.status, r.paymentStatus, Boolean(r.fulfilledAt));

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'review'; request: AdminReissueRequest; decision: ReissueDecision }
  | { kind: 'fulfil'; request: AdminReissueRequest };

export const AdminReissuePage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  // Opens on what staff act on next: requests to review and ones ready for a chip.
  const filter: AdminReissueFilter = FILTERS.some((f) => f.value === raw) ? (raw as AdminReissueFilter) : 'NEEDS_ACTION';
  // ?request=<id> shows one request (a stuck re-issue fee links here).
  const rawRequest = searchParams.get('request') ?? '';
  const requestId = UUID.test(rawRequest) ? rawRequest : '';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);

  const [reloadKey, setReloadKey] = useState(0);
  const { refresh: refreshQueues } = useWorkQueues();
  // Any reload after an action also updates the dashboard and nav counts.
  useEffect(() => { if (reloadKey > 0) refreshQueues(); }, [reloadKey, refreshQueues]);
  const queryKey = `${filter}|${requestId}|${page}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; rows: AdminReissueRequest[]; total: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listReissueRequests(requestId ? { id: requestId } : { status: filter, page, limit: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, rows: res.data.requests, total: res.data.pagination.total });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed('Re-issues')) });
      });
    return () => { cancelled = true; };
  }, [filter, requestId, page, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];
  const pages = Math.max(Math.ceil((result?.total ?? 0) / PAGE_SIZE), 1);

  const closeAndReload = () => {
    setDialog({ kind: 'none' });
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Re-issues</h1>
        <p className="text-gray-400 text-sm mt-1">
          Requests from owners whose chip is coming loose. Approve only when the photos show the chip still attached
          to the item.
        </p>
      </div>

      {requestId ? (
        <div role="status" className="flex flex-wrap items-center gap-3 text-sm text-gray-300">
          <span>Showing one request.</span>
          <button
            type="button"
            onClick={() => setSearchParams({})}
            className="min-h-[44px] px-4 rounded-xl bg-dark-700 text-gray-200 hover:bg-dark-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            Show all re-issues
          </button>
        </div>
      ) : (
        <FilterPills label="Filter by stage" options={FILTERS} value={filter} onChange={(v) => setSearchParams({ status: v })} />
      )}

      <ListState
        loading={loading}
        error={error}
        empty={rows.length === 0}
        emptyText={requestId ? 'That re-issue request was not found.' : filter === 'NEEDS_ACTION' ? 'Nothing needs action. Every request has been reviewed and every paid one has its new chip.' : 'No requests at this stage.'}
        what="re-issues"
      >
        <div className="space-y-4">
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
                  <div><dt className="inline text-gray-400">Requester: </dt><dd className="inline text-gray-200"><AccountLink id={r.requesterAccountId} email={r.requesterEmail} /></dd></div>
                  <div><dt className="inline text-gray-400">Requested: </dt><dd className="inline text-gray-200">{fmt(r.createdAt)}</dd></div>
                  <div><dt className="inline text-gray-400">Proof tap at: </dt><dd className="inline text-gray-200">{fmt(r.tappedAt)}</dd></div>
                  <div><dt className="inline text-gray-400">Fee: </dt><dd className="inline text-gray-200">{r.paymentStatus === 'WAIVED' ? 'Waived' : formatAmount(r.chargedAmount, r.chargedCurrency)}</dd></div>
                  {r.paidAt && <div><dt className="inline text-gray-400">Paid: </dt><dd className="inline text-gray-200">{fmt(r.paidAt)}</dd></div>}
                  {r.reviewReason && <div className="sm:col-span-2"><dt className="inline text-gray-400">Reason: </dt><dd className="inline text-gray-200">{r.reviewReason}</dd></div>}
                  {r.fulfilledAt && r.newTagId && (
                    <div className="sm:col-span-2">
                      <dt className="inline text-gray-400">New chip: </dt>
                      <dd className="inline"><Link to={`/admin/tags/${r.newTagId}`} className="text-primary-300 hover:underline">{r.newTagLabel ?? shortId(r.newTagId)}</Link></dd>
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
                    Move to new chip…
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        {!requestId && (
          <AdminPagination
            page={page}
            pages={pages}
            onPage={(p) => setSearchParams({ status: filter, ...(p > 1 ? { page: String(p) } : {}) })}
          />
        )}
        </div>
      </ListState>

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
            refreshQueues();
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
