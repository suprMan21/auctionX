/**
 * AdminApprovalsPage (S-2FA Ph3a) — two-admin approval.
 *
 * When FEATURE_ADMIN_TWO_PERSON is on, an admin's token suspend, token reset
 * ("Move token to a new chip"), account suspend and account retire do not run
 * straight away: they wait here until a second admin approves them (24 hours,
 * then they expire). Approving always needs a fresh passkey check, and the
 * action runs at that moment. The requester may cancel their own request.
 *
 * Opens on "Waiting for you". A row opens the request (?request=<id>, which is
 * also the deep link from the audit log and the "Sent for approval" message).
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { type Approval, type ApprovalFilter } from '../api/approvalSchemas';
import { AdminTable, Wrap, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, FilterPills, ListState } from '../components/AdminListParts';
import { AdminDialog, ADMIN_BUTTON_CLASS } from '../components/AdminDialog';
import { AccountLink } from '../components/AccountLink';
import { ErrorLine, REASON_MIN, ReasonField } from '../components/AdminTagDialogs';
import { ACTION_FAILED, errorMessage, formatWhen, loadFailed, NONE, shortId } from '../lib/display';
import { approvalActionLabel, approvalOutcomeLabel, approvalStatusLabel } from '../lib/labels';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { useWorkQueues } from '../lib/workQueues';
import { StepUpPanel } from '@/features/security/components/StepUpPanel';
import { isStepUpRefusal } from '@/features/security/lib/stepUp';

const PAGE_SIZE = 25;
/** The deep link looks the request up in the most recent ones (requests expire after 24 hours). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FILTERS: ReadonlyArray<{ label: string; value: ApprovalFilter }> = [
  { label: 'Waiting for you', value: 'waiting_for_me' },
  { label: 'Open', value: 'open' },
  { label: 'Done', value: 'closed' },
  { label: 'All', value: 'all' },
];

const EMPTY_TEXT: Record<ApprovalFilter, string> = {
  waiting_for_me: 'Nothing is waiting for you. Requests from other admins show up here.',
  open: 'No requests are waiting for approval.',
  closed: 'No decided or expired requests yet.',
  all: 'No approval requests yet.',
};

/** Plain-text name of what the request is about. */
const targetText = (a: Approval): string => {
  if (a.target.kind === 'account') return a.target.email ?? `Account ${shortId(a.target.id)}`;
  if (a.target.chipName) return a.target.chipName;
  return a.target.serialSuffix ? `Token …${a.target.serialSuffix}` : `Token ${shortId(a.target.id)}`;
};

const TargetLink = ({ approval }: { approval: Approval }) => {
  const access = useAdminRole();
  if (approval.target.kind === 'account') return <AccountLink id={approval.target.id} email={approval.target.email} />;
  const text = targetText(approval);
  if (!hasPermission(access, PERMISSIONS.manageNfc)) return <span className="font-mono">{text}</span>;
  return (
    <Link
      to={`/admin/tags/${encodeURIComponent(approval.target.id)}`}
      className="font-mono text-primary-300 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
    >
      {text}
    </Link>
  );
};

const statusTone = (a: Approval): string => {
  if (a.status === 'pending') return 'text-warning-500';
  if (a.status === 'approved') return a.outcome && !a.outcome.ok ? 'text-red-300' : 'text-emerald-300';
  return 'text-gray-300';
};

const hoursText = (hours: number): string =>
  hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? '' : 's'}` : `${hours} hour${hours === 1 ? '' : 's'}`;

export const AdminApprovalsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('status');
  const filter: ApprovalFilter = FILTERS.some((f) => f.value === raw) ? (raw as ApprovalFilter) : 'waiting_for_me';
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
  const rawRequest = searchParams.get('request') ?? '';
  const requestId = UUID.test(rawRequest) ? rawRequest : '';

  const [reloadKey, setReloadKey] = useState(0);
  const { refresh: refreshQueues } = useWorkQueues();
  const queryKey = `${filter}|${page}|${reloadKey}`;
  const [result, setResult] = useState<{ key: string; rows: Approval[]; pages: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .listApprovals({ status: filter, page, limit: PAGE_SIZE })
      .then((res) => {
        if (!cancelled) setResult({ key: queryKey, rows: res.approvals, pages: res.pagination.pages });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: queryKey, message: errorMessage(err, loadFailed('Approval requests')) });
      });
    return () => { cancelled = true; };
  }, [filter, page, queryKey]);

  // The open request, looked up fresh so its buttons match the server.
  const detailKey = `${requestId}|${reloadKey}`;
  const [detail, setDetail] = useState<{ key: string; approval: Approval | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!requestId) return;
    let cancelled = false;
    adminApi
      .listApprovals({ status: 'all', id: requestId, limit: 1 })
      .then((res) => {
        if (!cancelled) setDetail({ key: detailKey, approval: res.approvals.find((a) => a.id === requestId) ?? null, error: null });
      })
      .catch((err) => {
        if (!cancelled) setDetail({ key: detailKey, approval: null, error: errorMessage(err, loadFailed('The request')) });
      });
    return () => { cancelled = true; };
  }, [requestId, detailKey]);

  const error = failure?.key === queryKey ? failure.message : null;
  const loading = !error && result?.key !== queryKey;
  const rows = result?.key === queryKey ? result.rows : [];
  const pages = Math.max(result?.pages ?? 1, 1);

  const listParams = (extra: Record<string, string> = {}): Record<string, string> => ({
    ...(filter !== 'waiting_for_me' ? { status: filter } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
    ...extra,
  });
  const rowHref = (a: Approval) => `/admin/approvals?${new URLSearchParams(listParams({ request: a.id })).toString()}`;
  // Stable, so the open dialog does not lose focus when the page re-renders.
  const closeDetail = useCallback(() => setSearchParams({
    ...(filter !== 'waiting_for_me' ? { status: filter } : {}),
    ...(page > 1 ? { page: String(page) } : {}),
  }), [filter, page, setSearchParams]);
  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
    refreshQueues();
  }, [refreshQueues]);

  const columns: ReadonlyArray<AdminColumn<Approval>> = [
    {
      key: 'what',
      header: 'What',
      width: 200,
      className: 'text-white font-medium',
      cell: (a) => (
        <Link to={rowHref(a)} className="hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
          {approvalActionLabel(a.action)}
        </Link>
      ),
    },
    { key: 'target', header: 'Token or account', width: 200, cell: (a) => <TargetLink approval={a} /> },
    { key: 'by', header: 'Asked by', width: 200, cell: (a) => <Wrap text={a.requestedBy.email ?? shortId(a.requestedBy.id)} /> },
    { key: 'reason', header: 'Reason', cell: (a) => a.reason },
    {
      key: 'when',
      header: 'Asked / Expires',
      width: 190,
      cell: (a) => (
        <span className="flex flex-col">
          <span>{formatWhen(a.requestedAt)}</span>
          {a.status === 'pending' && <span className="text-xs text-gray-400">Expires {formatWhen(a.expiresAt)}</span>}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 170,
      cell: (a) => (
        <span className={statusTone(a)}>
          {a.status === 'approved' && a.outcome && !a.outcome.ok ? 'Approved, did not run' : approvalStatusLabel(a.status)}
        </span>
      ),
    },
  ];

  // A reload after a decision keeps showing the request (and the dialog's result) until the fresh copy arrives.
  const shown = detail && detail.key.startsWith(`${requestId}|`) ? detail : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Approvals</h1>
        <p className="text-gray-400 text-sm mt-1">
          Suspending a token or account, moving a token to a new chip and retiring an account need a second admin.
          A request runs only when another admin approves it, and expires after 24 hours.
        </p>
      </div>

      <FilterPills
        label="Filter requests"
        options={FILTERS}
        value={filter}
        onChange={(v) => setSearchParams(v === 'waiting_for_me' ? {} : { status: v })}
      />

      <ListState loading={loading} error={error} empty={rows.length === 0} emptyText={EMPTY_TEXT[filter]} what="approval requests">
        <div className="space-y-4">
          <AdminTable id="admin-approvals" label="Approval requests" columns={columns} rows={rows} rowKey={(a) => a.id} rowHref={rowHref} />
          <AdminPagination
            page={page}
            pages={pages}
            onPage={(p) => setSearchParams({ ...(filter !== 'waiting_for_me' ? { status: filter } : {}), ...(p > 1 ? { page: String(p) } : {}) })}
          />
        </div>
      </ListState>

      {requestId && (
        <ApprovalDetailDialog
          key={requestId}
          loading={!shown}
          approval={shown?.approval ?? null}
          loadError={shown?.error ?? null}
          onClose={closeDetail}
          onChanged={reload}
        />
      )}
    </div>
  );
};

// ── One request ─────────────────────────────────────────────────────────────

type Mode =
  | { kind: 'view' }
  | { kind: 'step-up' }
  | { kind: 'reject' }
  | { kind: 'done'; message: string };

const ApprovalDetailDialog = ({
  loading, approval, loadError, onClose, onChanged,
}: {
  loading: boolean;
  approval: Approval | null;
  loadError: string | null;
  onClose: () => void;
  /** Reload the list, the request and the queue counts. */
  onChanged: () => void;
}) => {
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = approval ? `${approvalActionLabel(approval.action)}: ${targetText(approval)}` : 'Approval request';

  const approve = async (stepUpToken: string) => {
    if (!approval) return;
    setMode({ kind: 'view' });
    setBusy(true);
    setError(null);
    try {
      await adminApi.approveApproval(approval.id, stepUpToken);
      setMode({ kind: 'done', message: `Approved. ${approvalActionLabel(approval.action)} is done.` });
      onChanged();
    } catch (err) {
      if (isStepUpRefusal(err)) { setMode({ kind: 'step-up' }); return; }
      // Approved but the action itself failed (e.g. a transfer is pending): the request shows why.
      setError(errorMessage(err, ACTION_FAILED));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.rejectApproval(approval.id, reason.trim());
      setMode({ kind: 'done', message: 'Rejected. Nothing was changed.' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async () => {
    if (!approval) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi.cancelApproval(approval.id);
      setMode({ kind: 'done', message: 'Request cancelled. Nothing was changed.' });
      onChanged();
    } catch (err) {
      setError(errorMessage(err, ACTION_FAILED));
    } finally {
      setBusy(false);
    }
  };

  const secondary = `${ADMIN_BUTTON_CLASS} bg-dark-700 text-gray-200 hover:bg-dark-600`;

  return (
    <AdminDialog open onClose={onClose} title={title} danger={approval?.action === 'tag_reset' || approval?.action === 'account_retire'}>
      {loading ? (
        <p role="status" className="text-sm text-gray-400">Loading the request…</p>
      ) : !approval ? (
        <>
          <p role="alert" className="text-sm text-red-400">{loadError ?? 'That request was not found. It may be older than the most recent 100.'}</p>
          <div className="flex justify-end"><button type="button" onClick={onClose} className={secondary}>Close</button></div>
        </>
      ) : mode.kind === 'done' ? (
        <>
          <p role="status" className="rounded-xl border border-emerald-400/30 px-4 py-3 text-sm text-emerald-300">{mode.message}</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}>Done</button>
          </div>
        </>
      ) : mode.kind === 'step-up' ? (
        <StepUpPanel
          action="admin_approve"
          targetId={approval.id}
          purpose="approve this request"
          onConfirmed={(token) => void approve(token)}
          onCancel={() => setMode({ kind: 'view' })}
        />
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-y-2 text-sm">
            <Row label={approval.target.kind === 'account' ? 'Account' : 'Token'}><TargetLink approval={approval} /></Row>
            {approval.action === 'tag_reset' && (
              <Row label="New chip">
                {approval.details.newChip?.chipName
                  ?? (approval.details.newChip?.serialSuffix ? `Token …${approval.details.newChip.serialSuffix}` : approval.details.newTagId ? shortId(approval.details.newTagId) : NONE)}
              </Row>
            )}
            {approval.action === 'account_suspend' && typeof approval.details.hours === 'number' && (
              <Row label="Length">{hoursText(approval.details.hours)}</Row>
            )}
            <Row label="Asked by"><Wrap text={approval.requestedBy.email ?? shortId(approval.requestedBy.id)} /></Row>
            <Row label="Asked">{formatWhen(approval.requestedAt)}</Row>
            {approval.status === 'pending' && <Row label="Expires">{formatWhen(approval.expiresAt)}</Row>}
            <Row label="Reason">{approval.reason}</Row>
            <Row label="Status"><span className={statusTone(approval)}>{approvalOutcomeLabel(approval)}</span></Row>
            {approval.decidedAt && <Row label="Decided">{formatWhen(approval.decidedAt)}</Row>}
            {approval.decisionNote && <Row label={approval.status === 'rejected' ? 'Why it was rejected' : 'Note'}>{approval.decisionNote}</Row>}
          </dl>

          {approval.status === 'pending' && !approval.canApprove && !approval.canCancel && (
            <p className="text-sm text-gray-400">Another admin with access to this action approves it.</p>
          )}
          {approval.canCancel && (
            <p className="text-sm text-gray-400">You asked for this. Another admin must approve it.</p>
          )}

          {mode.kind === 'reject' && <ReasonField value={reason} onChange={setReason} />}
          <ErrorLine message={error} />

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={onClose} className={secondary}>Close</button>
            {approval.canCancel && (
              <button type="button" onClick={() => void cancelRequest()} disabled={busy} className={secondary}>
                {busy ? 'Cancelling…' : 'Cancel request'}
              </button>
            )}
            {approval.canApprove && mode.kind === 'reject' && (
              <button
                type="button"
                onClick={() => void reject()}
                disabled={busy || reason.trim().length < REASON_MIN}
                className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}
              >
                {busy ? 'Rejecting…' : 'Reject request'}
              </button>
            )}
            {approval.canApprove && mode.kind === 'view' && (
              <>
                <button type="button" onClick={() => { setError(null); setMode({ kind: 'reject' }); }} disabled={busy} className={secondary}>
                  Reject…
                </button>
                <button
                  type="button"
                  onClick={() => { setError(null); setMode({ kind: 'step-up' }); }}
                  disabled={busy}
                  className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}
                >
                  {busy ? 'Approving…' : 'Approve…'}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </AdminDialog>
  );
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-wrap gap-x-2">
    <dt className="text-gray-400">{label}:</dt>
    <dd className="text-gray-200 break-words [overflow-wrap:anywhere]">{children}</dd>
  </div>
);
