/**
 * AdminStuckPaymentsPage (S-ADMIN1 Ph3a) — token fees Stripe took that did not
 * apply.
 *
 * Each row is one payment: a transfer fee or a replacement chip fee. Two
 * actions only. Re-apply re-runs the normal payment step (support and above).
 * Refund sends the money back (admin and super_admin). Nobody edits ownership
 * by hand.
 *
 * The check also runs by itself every 10 minutes; "Check now" runs it at once.
 */

import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  adminApi,
  type AdminStuckPayment,
  type AdminStuckPaymentFilter,
  type AdminStuckPaymentListResponse,
  type AdminStuckPaymentReason,
} from '../api/adminApi';
import { AdminReapplyPaymentDialog, AdminRefundPaymentDialog } from '../components/AdminStuckPaymentDialogs';
import { moneyOf } from '../lib/stuckPayments';

const FILTERS: ReadonlyArray<{ label: string; value: AdminStuckPaymentFilter }> = [
  { label: 'Open', value: 'OPEN' },
  { label: 'Applied', value: 'RESOLVED' },
  { label: 'Refunded', value: 'REFUNDED' },
  { label: 'All', value: 'ALL' },
];

/** What went wrong, and what to do about it. */
const REASON_COPY: Record<AdminStuckPaymentReason, { what: string; next: string }> = {
  webhook_missed: {
    what: 'Stripe took the payment but never told us.',
    next: 'Re-apply to complete it.',
  },
  apply_failed: {
    what: 'The payment arrived but applying it failed.',
    next: 'Re-apply. If it fails again, the debug team has the details.',
  },
  no_recipient: {
    what: 'The payment arrived but the transfer has no recipient account yet.',
    next: 'Ask the recipient to sign in and accept, then Re-apply.',
  },
  not_payable: {
    what: 'The payment arrived after the transfer or request was cancelled or changed.',
    next: 'This cannot be applied. Refund it.',
  },
  intent_mismatch: {
    what: 'The payment names a transfer or request that is waiting for a different payment.',
    next: 'This cannot be applied. Refund it.',
  },
  row_missing: {
    what: 'The payment names a transfer or request that does not exist.',
    next: 'This cannot be applied. Refund it.',
  },
};

const CAN_REAPPLY: ReadonlySet<AdminStuckPaymentReason> = new Set(['webhook_missed', 'apply_failed', 'no_recipient']);

const RESOLUTION_COPY: Record<NonNullable<AdminStuckPayment['resolution']>, string> = {
  webhook: 'Applied by a later Stripe retry',
  sweep: 'Applied by the automatic check',
  reapply: 'Applied by Re-apply',
  refund: 'Refunded',
};

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
const shortId = (id: string | null): string => (id ? `${id.slice(0, 8)}…` : '—');

type OpenDialog =
  | { kind: 'none' }
  | { kind: 'reapply'; payment: AdminStuckPayment }
  | { kind: 'refund'; payment: AdminStuckPayment };

type QueueData = AdminStuckPaymentListResponse['data'];

export const AdminStuckPaymentsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  const filter: AdminStuckPaymentFilter = FILTERS.some((f) => f.value === raw) ? (raw as AdminStuckPaymentFilter) : 'OPEN';

  const [reloadKey, setReloadKey] = useState(0);
  const queryKey = `${filter}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; data: QueueData } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listStuckPayments({ status: filter, limit: 50 })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, data: res.data });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: err instanceof Error ? err.message : 'Failed to load stuck payments' });
      });
    return () => { cancelled = true; };
  }, [filter, queryKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const data = result?.key === queryKey ? result.data : null;
  const rows = data?.items ?? [];

  const closeAndReload = () => {
    setDialog({ kind: 'none' });
    setReloadKey((k) => k + 1);
  };

  const checkNow = async () => {
    setChecking(true);
    setCheckNote(null);
    try {
      const { data: summary } = await adminApi.sweepStuckPayments();
      const parts = [
        `${summary.checked} paid ${summary.checked === 1 ? 'fee' : 'fees'} checked`,
        `${summary.applied} applied`,
        `${summary.stuck} stuck`,
      ];
      setCheckNote({
        tone: 'ok',
        text: `${parts.join(', ')}.${summary.truncated ? ' More payments than one check covers; run it again.' : ''}`,
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      setCheckNote({ tone: 'error', text: err instanceof Error ? err.message : 'The check failed' });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Stuck payments</h1>
          <p className="text-gray-400 text-sm mt-1 max-w-2xl">
            Fees Stripe took that did not go through on our side. Re-apply finishes the payment the normal way. Refund
            sends the money back. Never change who owns a token by hand.
          </p>
        </div>
        <button
          type="button"
          onClick={checkNow}
          disabled={checking}
          className="px-3 py-2 rounded-xl text-sm font-medium bg-dark-700 text-gray-200 hover:bg-dark-600
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {checkNote && (
        <p
          role={checkNote.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${checkNote.tone === 'error' ? 'text-red-400' : 'text-gray-300'}`}
        >
          {checkNote.text}
        </p>
      )}

      {data && (!data.sweepConfigured || !data.githubIssuesConfigured) && (
        <div role="note" className="glass rounded-2xl p-4 border border-amber-500/30 text-sm text-amber-300 space-y-1">
          {!data.sweepConfigured && (
            <p>The automatic 10-minute check is not set up on this server. Use Check now until it is.</p>
          )}
          {!data.githubIssuesConfigured && (
            <p>GitHub Issues are not set up on this server, so the debug team is not being told about new stuck payments.</p>
          )}
        </div>
      )}

      <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by state">
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
        <div className="flex items-center justify-center h-48" role="status" aria-label="Loading stuck payments">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p role="alert" className="text-red-400 text-sm">{error}</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-2xl p-6">
          <p className="text-gray-400 text-sm">
            {filter === 'OPEN' ? 'No stuck payments. Every paid fee has gone through.' : 'Nothing here.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-4" aria-label="Stuck payments">
          {rows.map((p) => {
            const copy = REASON_COPY[p.reason];
            const open = p.status === 'OPEN';
            return (
              <li key={p.id} className="glass rounded-2xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h2 className="text-white font-semibold">
                      {p.kind === 'transfer_fee' ? 'Transfer fee' : 'Replacement chip fee'}, {moneyOf(p.amount, p.currency)}
                    </h2>
                    <p className="text-sm text-gray-300">{copy.what}</p>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border
                      ${open ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                        : p.status === 'REFUNDED' ? 'bg-dark-700 text-gray-300 border-white/10'
                        : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'}`}
                  >
                    {open ? 'Open' : p.resolution ? RESOLUTION_COPY[p.resolution] : p.status}
                  </span>
                </div>

                {open && <p className="text-sm text-gray-200">{copy.next}</p>}

                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <dt className="inline text-gray-400">Token: </dt>
                    <dd className="inline">
                      {p.target?.tagId ? (
                        <Link
                          to={`/admin/tags/${p.target.tagId}`}
                          className="font-mono text-primary-300 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {p.target.chipName ?? shortId(p.target.tagId)}
                        </Link>
                      ) : (
                        <span className="text-gray-200">—</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline text-gray-400">{p.kind === 'transfer_fee' ? 'Transfer' : 'Request'} now: </dt>
                    <dd className="inline text-gray-200">
                      {p.target
                        ? [p.target.status, p.target.paymentStatus].filter(Boolean).join(', ').toLowerCase().replace(/_/g, ' ')
                        : 'no longer exists'}
                    </dd>
                  </div>
                  <div><dt className="inline text-gray-400">Payment id: </dt><dd className="inline font-mono text-gray-200 break-all">{p.paymentIntentId}</dd></div>
                  <div>
                    <dt className="inline text-gray-400">{p.kind === 'transfer_fee' ? 'Transfer id: ' : 'Request id: '}</dt>
                    <dd className="inline font-mono text-gray-200">{shortId(p.transferId ?? p.reissueRequestId)}</dd>
                  </div>
                  <div><dt className="inline text-gray-400">First seen: </dt><dd className="inline text-gray-200">{fmt(p.firstSeenAt)}</dd></div>
                  <div><dt className="inline text-gray-400">Last seen: </dt><dd className="inline text-gray-200">{fmt(p.lastSeenAt)} ({p.seenCount}×)</dd></div>
                  {p.resolvedAt && <div><dt className="inline text-gray-400">Closed: </dt><dd className="inline text-gray-200">{fmt(p.resolvedAt)}</dd></div>}
                  {p.refundId && <div><dt className="inline text-gray-400">Refund id: </dt><dd className="inline font-mono text-gray-200 break-all">{p.refundId}</dd></div>}
                  {p.lastError && <div><dt className="inline text-gray-400">Error code: </dt><dd className="inline font-mono text-gray-200">{p.lastError}</dd></div>}
                  {p.githubIssueUrl && p.githubIssueNumber !== null && (
                    <div>
                      <dt className="inline text-gray-400">Debug ticket: </dt>
                      <dd className="inline">
                        <a
                          href={p.githubIssueUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary-300 hover:underline rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          GitHub issue #{p.githubIssueNumber}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>

                {open && (
                  <div className="flex flex-wrap gap-2">
                    {CAN_REAPPLY.has(p.reason) && (
                      <ActionButton onClick={() => setDialog({ kind: 'reapply', payment: p })} tone="primary">
                        Re-apply…
                      </ActionButton>
                    )}
                    {data?.canRefund ? (
                      <ActionButton onClick={() => setDialog({ kind: 'refund', payment: p })} tone="danger">
                        Refund…
                      </ActionButton>
                    ) : !CAN_REAPPLY.has(p.reason) ? (
                      <p className="text-sm text-gray-400">A refund needs an admin.</p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog.kind === 'reapply' && (
        <AdminReapplyPaymentDialog open payment={dialog.payment} onClose={() => setDialog({ kind: 'none' })} onDone={closeAndReload} />
      )}
      {dialog.kind === 'refund' && (
        <AdminRefundPaymentDialog open payment={dialog.payment} onClose={() => setDialog({ kind: 'none' })} onDone={closeAndReload} />
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
