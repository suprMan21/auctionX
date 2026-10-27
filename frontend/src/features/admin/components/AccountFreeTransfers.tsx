/**
 * Admin console UX-3 — free transfers on an account page (manage_pricing).
 * Looking them up is an audited email lookup on the server, so nothing loads
 * until staff click Show; granting opens the usual dialog with the email
 * already filled in (the typed reason stays).
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AdminVoucherGrant } from '../api/pricingSchemas';
import { AdminGrantVouchersDialog } from './AdminVoucherDialogs';
import { ADMIN_BUTTON_CLASS } from './AdminDialog';
import { errorMessage, formatDay, loadFailed } from '../lib/display';

const STATUS_TEXT: Record<AdminVoucherGrant['status'], string> = {
  active: 'Active',
  used_up: 'All used',
  expired: 'Expired',
  revoked: 'Revoked',
};

export const AccountFreeTransfers = ({ email }: { email: string }) => {
  const [grants, setGrants] = useState<AdminVoucherGrant[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState(false);

  const load = () => {
    setBusy(true);
    setError(null);
    adminApi
      .listVoucherGrants({ email, limit: 25 })
      .then((list) => setGrants(list.grants))
      .catch((err) => setError(errorMessage(err, loadFailed('Free transfers'))))
      .finally(() => setBusy(false));
  };

  const unused = grants?.filter((g) => g.status === 'active').reduce((n, g) => n + g.remaining, 0) ?? 0;

  return (
    <section className="glass rounded-2xl p-5 space-y-3" aria-labelledby="free-transfers-heading">
      <h2 id="free-transfers-heading" className="text-base font-semibold text-white">Free transfers</h2>
      <div className="flex flex-wrap gap-2">
        {grants === null && (
          <button type="button" onClick={load} disabled={busy} className={`${ADMIN_BUTTON_CLASS} min-h-[44px] bg-dark-700 hover:bg-dark-600 text-white`}>
            {busy ? 'Loading free transfers…' : 'Show free transfers'}
          </button>
        )}
        <button type="button" onClick={() => setGranting(true)} className={`${ADMIN_BUTTON_CLASS} min-h-[44px] bg-primary-600 hover:bg-primary-500 text-white`}>
          Grant free transfers…
        </button>
      </div>
      {grants === null && <p className="text-sm text-gray-400">Looking them up is recorded in the audit log.</p>}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {grants !== null && (
        grants.length === 0 ? (
          <p className="text-sm text-gray-400">No free transfers granted to this account.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-200">{unused} unused free transfer{unused === 1 ? '' : 's'}.</p>
            <ul className="divide-y divide-white/5 text-sm">
              {grants.map((g) => (
                <li key={g.id} className="py-2 flex flex-wrap gap-x-4 gap-y-1 text-gray-300">
                  <span>{formatDay(g.createdAt)}</span>
                  <span>{g.remaining} of {g.quantity} left</span>
                  <span className="text-gray-400">{STATUS_TEXT[g.status]}</span>
                  {g.expiresAt && <span className="text-gray-400">Expires {formatDay(g.expiresAt)}</span>}
                </li>
              ))}
            </ul>
            <Link to="/admin/settings?tab=free-transfers" className="inline-block text-sm text-primary-300 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
              Revoke or see all free transfers →
            </Link>
          </div>
        )
      )}

      <AdminGrantVouchersDialog
        open={granting}
        presetEmail={email}
        onClose={() => setGranting(false)}
        onDone={() => {
          setGranting(false);
          // Show the new grant: a fresh, audited lookup of this account.
          load();
        }}
      />
    </section>
  );
};
