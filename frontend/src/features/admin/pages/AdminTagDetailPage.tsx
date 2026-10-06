/**
 * AdminTagDetailPage (S-ADMIN1) — one chip: state, custody chain, taps,
 * Ownership ID status, admin audit trail, and the actions allowed in its
 * current state (suspend / lift suspension / reset). Retired and released chips
 * show no actions: both states are terminal.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminApi, chipLabel, type AdminTagDetailResponse } from '../api/adminApi';
import { AdminLifecycleBadge } from '../components/AdminLifecycleBadge';
import { AdminResetDialog, AdminSuspendDialog } from '../components/AdminTagDialogs';
import { ADMIN_BUTTON_CLASS } from '../components/AdminDialog';

type Detail = AdminTagDetailResponse['data'];
type OpenDialog = 'suspend' | 'unsuspend' | 'reset' | null;

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
const money = (cents: number | null, currency: string | null): string =>
  cents === null ? '—' : `${(cents / 100).toFixed(2)} ${(currency ?? 'usd').toUpperCase()}`;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="glass rounded-2xl p-5 space-y-3" aria-label={title}>
    <h2 className="text-base font-semibold text-white">{title}</h2>
    {children}
  </section>
);

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <dt className="text-xs text-gray-400">{label}</dt>
    <dd className="text-sm text-gray-100 break-all">{children}</dd>
  </div>
);

export const AdminTagDetailPage = () => {
  const { tagId = '' } = useParams<{ tagId: string }>();
  const navigate = useNavigate();
  // Keyed by tagId so navigating to another chip shows the spinner without a
  // synchronous reset inside the effect.
  const [loaded, setLoaded] = useState<{ tagId: string; data: Detail } | null>(null);
  const [failure, setFailure] = useState<{ tagId: string; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    adminApi
      .getTag(tagId)
      .then((res) => { setFailure(null); setLoaded({ tagId, data: res.data }); })
      .catch((err) => setFailure({ tagId, message: err instanceof Error ? err.message : 'Failed to load tag' }));
  }, [tagId]);

  useEffect(() => { load(); }, [load]);

  const detail = loaded?.tagId === tagId ? loaded.data : null;
  const error = failure?.tagId === tagId ? failure.message : null;

  if (error) {
    return (
      <div className="glass rounded-2xl p-6 border border-red-500/30">
        <p role="alert" className="text-red-400 text-sm">{error}</p>
        <Link to="/admin/tags" className="text-primary-300 text-sm hover:underline">Back to tags</Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="flex items-center justify-center h-48" role="status" aria-label="Loading tag">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { tag } = detail;
  const canSuspend = tag.lifecycleStatus === 'ACTIVE';
  const canUnsuspend = tag.lifecycleStatus === 'SUSPENDED';
  const canReset = tag.lifecycleStatus === 'ACTIVE' || tag.lifecycleStatus === 'SUSPENDED';
  const closeDialog = () => setDialog(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Link to="/admin/tags" className="text-primary-300 text-sm hover:underline">← Tags</Link>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <span className="font-mono">Chip {chipLabel(tag)}</span>
            <AdminLifecycleBadge status={tag.lifecycleStatus} />
          </h1>
        </div>
        {(canSuspend || canUnsuspend || canReset) && (
          <div className="flex gap-2">
            {canSuspend && (
              <button type="button" onClick={() => setDialog('suspend')} className={`${ADMIN_BUTTON_CLASS} bg-amber-600 hover:bg-amber-500 text-white`}>
                Suspend
              </button>
            )}
            {canUnsuspend && (
              <button type="button" onClick={() => setDialog('unsuspend')} className={`${ADMIN_BUTTON_CLASS} bg-primary-600 hover:bg-primary-500 text-white`}>
                Lift suspension
              </button>
            )}
            {canReset && (
              <button type="button" onClick={() => setDialog('reset')} className={`${ADMIN_BUTTON_CLASS} bg-red-600 hover:bg-red-500 text-white`}>
                Reset token…
              </button>
            )}
          </div>
        )}
      </div>

      {notice && (
        <p role="status" className="glass rounded-2xl px-4 py-3 text-sm text-emerald-300 border border-emerald-400/30">{notice}</p>
      )}

      {tag.lifecycleStatus === 'RETIRED' && (
        <div className="glass rounded-2xl px-4 py-3 text-sm border border-red-500/30 text-red-300">
          Retired {fmt(tag.retiredAt)}. Destruction: <strong>{tag.destructionStatus ?? '—'}</strong>.
          {tag.replacedByTagId && (
            <> Replaced by <Link to={`/admin/tags/${tag.replacedByTagId}`} className="underline">this chip</Link>.</>
          )}
          {tag.retiredReason && <span className="block mt-1 text-gray-300">Reason: {tag.retiredReason}</span>}
        </div>
      )}
      {tag.lifecycleStatus === 'SUSPENDED' && (
        <div className="glass rounded-2xl px-4 py-3 text-sm border border-amber-400/30 text-amber-300">
          Suspended {fmt(tag.suspendedAt)}.
          {tag.suspendedReason && <span className="block mt-1 text-gray-300">Reason: {tag.suspendedReason}</span>}
        </div>
      )}

      <Section title="Chip">
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Field label="Owner account (internal)">{tag.ownerAccountId ?? '—'}</Field>
          <Field label="Creator account">{tag.creatorAccountId ?? '—'}</Field>
          <Field label="Item">{tag.itemId ?? '—'}</Field>
          <Field label="Key version">{tag.sdmKeyVersion ?? '—'}</Field>
          <Field label="Tap counter">{tag.sunCounter}</Field>
          <Field label="Enrolled">{fmt(tag.registeredAt)}</Field>
          <Field label="Activated">{fmt(tag.activatedAt)}</Field>
          <Field label="Ownership ID">
            {detail.ownershipId.status === 'current' ? `Current since ${fmt(detail.ownershipId.issuedAt)}` : 'None'}
          </Field>
        </dl>
        {detail.replacesTagIds.length > 0 && (
          <p className="text-sm text-gray-300">
            Replaces{' '}
            {detail.replacesTagIds.map((id, i) => (
              <span key={id}>{i > 0 && ', '}<Link to={`/admin/tags/${id}`} className="text-primary-300 underline">retired chip</Link></span>
            ))}
            .
          </p>
        )}
      </Section>

      <Section title="Custody chain">
        {detail.custody.length === 0 ? (
          <p className="text-sm text-gray-400">No transfers recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th scope="col" className="text-left py-2 pr-4 font-medium">Type</th>
                  <th scope="col" className="text-left py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="text-left py-2 pr-4 font-medium">From</th>
                  <th scope="col" className="text-left py-2 pr-4 font-medium">To</th>
                  <th scope="col" className="text-left py-2 pr-4 font-medium">Charged</th>
                  <th scope="col" className="text-left py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {detail.custody.map((c) => (
                  <tr key={c.id} className="border-t border-white/5 text-gray-200">
                    <td className="py-2 pr-4">{c.type}{c.reissue ? ' (re-issue)' : ''}</td>
                    <td className="py-2 pr-4">{c.status ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{c.fromAccountId ?? '—'}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{c.toAccountId ?? '—'}</td>
                    <td className="py-2 pr-4">{money(c.chargedAmount, c.chargedCurrency)}</td>
                    <td className="py-2">{fmt(c.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Recent taps">
        {detail.taps.length === 0 ? (
          <p className="text-sm text-gray-400">No taps recorded.</p>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {detail.taps.map((t) => (
              <li key={t.id} className="py-2 flex flex-wrap gap-x-4 text-gray-200">
                <span>{fmt(t.at)}</span>
                <span className={t.valid ? 'text-emerald-300' : 'text-red-300'}>{t.valid ? '✓ valid' : '✕ invalid'}</span>
                <span>counter {t.counter ?? '—'}</span>
                {t.accountId && <span className="font-mono text-xs text-gray-400">by {t.accountId}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Admin audit trail">
        {detail.audit.length === 0 ? (
          <p className="text-sm text-gray-400">No admin actions on this chip.</p>
        ) : (
          <ul className="divide-y divide-white/5 text-sm">
            {detail.audit.map((a) => (
              <li key={a.id} className="py-2 text-gray-200">
                <span className="font-medium">{a.action}</span> by {a.adminEmail} · {fmt(a.at)}
                {a.reason && <span className="block text-gray-400">“{a.reason}”</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AdminSuspendDialog
        open={dialog === 'suspend' || dialog === 'unsuspend'}
        suspend={dialog === 'suspend'}
        tag={tag}
        onClose={closeDialog}
        onDone={() => {
          setNotice(dialog === 'suspend' ? 'Token suspended.' : 'Suspension lifted.');
          closeDialog();
          load();
        }}
      />
      <AdminResetDialog
        open={dialog === 'reset'}
        tag={tag}
        onClose={closeDialog}
        onDone={(newTagId) => {
          closeDialog();
          navigate(`/admin/tags/${newTagId}`);
        }}
      />
    </div>
  );
};
