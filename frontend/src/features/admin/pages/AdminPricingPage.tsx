/**
 * AdminPricingPage (S-ADMIN1 Ph3b) — token prices, set by an admin.
 *
 * Shows the price in effect for each kind, any scheduled changes, and the
 * history. Each price card has its own Change button (UX-2); a change starts
 * now when no start date is entered, else at that time; a scheduled change can be
 * cancelled before it starts. A price already in effect is never edited: set a
 * new one. Admin and super_admin only.
 */

import { useEffect, useState } from 'react';
import { adminApi } from '../api/adminApi';
import { PRICE_KINDS, type AdminPriceChange, type AdminPricing, type PriceKind } from '../api/pricingSchemas';
import { AdminCancelPriceDialog, AdminSetPriceDialog } from '../components/AdminPricingDialogs';
import { PRICE_LABEL, fmtDateTime, usd } from '../lib/pricing';
import { errorMessage, loadFailed } from '../lib/display';

const STATUS_COPY: Record<AdminPriceChange['status'], { label: string; className: string }> = {
  in_effect: { label: 'In effect', className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' },
  scheduled: { label: 'Scheduled', className: 'bg-amber-500/10 text-amber-300 border-amber-500/30' },
  superseded: { label: 'Replaced', className: 'bg-dark-700 text-gray-300 border-white/10' },
  cancelled: { label: 'Cancelled', className: 'bg-dark-700 text-gray-400 border-white/10 line-through' },
};

type OpenDialog = { kind: 'none' } | { kind: 'set'; price: PriceKind } | { kind: 'cancel'; change: AdminPriceChange };

/** `embedded`: shown inside Settings, so its title is a section heading. */
export const AdminPricingPage = ({ embedded = false }: { embedded?: boolean }) => {
  const Heading = embedded ? 'h2' : 'h1';
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<{ key: number; data: AdminPricing } | null>(null);
  const [failure, setFailure] = useState<{ key: number; message: string } | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>({ kind: 'none' });

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getPricing()
      .then((data) => {
        if (!cancelled) setResult({ key: reloadKey, data });
      })
      .catch((err) => {
        if (!cancelled) setFailure({ key: reloadKey, message: errorMessage(err, loadFailed('Prices')) });
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const error = failure?.key === reloadKey ? failure.message : null;
  // Keep showing the last data while a reload runs, so the page does not flash.
  const data = result?.data ?? null;
  const loading = !error && !data;

  const closeAndReload = () => {
    setDialog({ kind: 'none' });
    setReloadKey((k) => k + 1);
  };

  const scheduled = (data?.history ?? [])
    .filter((h) => h.status === 'scheduled')
    .sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Heading className={embedded ? 'text-xl font-semibold text-white' : 'text-2xl font-bold text-white'}>Pricing</Heading>
          <p className="text-gray-400 text-sm mt-1 max-w-2xl">
            What a transfer, a re-issue and a new token cost, in US dollars. A change applies only to transfers started,
            and re-issue requests made, after it takes effect. Transfers already started keep the price they started with.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48" role="status" aria-label="Loading prices">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="glass rounded-2xl p-6 border border-red-500/30">
          <p role="alert" className="text-red-400 text-sm">{error}</p>
        </div>
      ) : data ? (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-label="Prices in effect">
            {PRICE_KINDS.map((kind) => {
              const next = scheduled.find((s) => s.kind === kind);
              return (
                <li key={kind} className="glass rounded-2xl p-5 space-y-1">
                  <h2 className="text-sm font-medium text-gray-400">{PRICE_LABEL[kind]}</h2>
                  <p className="text-2xl font-semibold text-white">{usd(data.current[kind])}</p>
                  <p className="text-xs text-gray-400">Default price {usd(data.defaults[kind])}</p>
                  {next && (
                    <p className="text-xs text-amber-300">
                      Changes to {usd(next.amountUsdCents)} on {fmtDateTime(next.effectiveFrom)}
                    </p>
                  )}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: 'set', price: kind })}
                      className="min-h-[44px] px-4 py-2 rounded-xl text-sm font-medium bg-primary-600 text-white hover:bg-primary-500
                        focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
                    >
                      Change<span className="sr-only"> {PRICE_LABEL[kind].toLowerCase()}</span>…
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <section aria-labelledby="price-history-heading" className="glass rounded-2xl p-5 space-y-3">
            <h2 id="price-history-heading" className="text-white font-semibold">Scheduled changes and history</h2>
            {data.history.length === 0 ? (
              <p className="text-gray-400 text-sm">No price changes yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-gray-400">
                    <tr>
                      <th scope="col" className="py-2 pr-4 font-medium">Price</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Amount</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Takes effect</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Reason</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Set by</th>
                      <th scope="col" className="py-2 font-medium"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.history.map((h) => {
                      const badge = STATUS_COPY[h.status];
                      return (
                        <tr key={h.id} className="align-top">
                          <td className="py-2 pr-4 text-gray-200">{PRICE_LABEL[h.kind]}</td>
                          <td className="py-2 pr-4 text-white">{usd(h.amountUsdCents)}</td>
                          <td className="py-2 pr-4 text-gray-200">{fmtDateTime(h.effectiveFrom)}</td>
                          <td className="py-2 pr-4">
                            <span className={`px-2 py-0.5 rounded-lg text-xs font-medium border ${badge.className}`}>{badge.label}</span>
                          </td>
                          <td className="py-2 pr-4 text-gray-300 max-w-xs">
                            {h.reason}
                            {h.status === 'cancelled' && (
                              <span className="block text-xs text-gray-400 mt-1">
                                Cancelled {fmtDateTime(h.cancelledAt)}{h.cancelledBy ? ` by ${h.cancelledBy}` : ''}
                                {h.cancelReason ? `: ${h.cancelReason}` : ''}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4 text-gray-300">{h.createdBy ?? 'Default'}</td>
                          <td className="py-2">
                            {h.status === 'scheduled' && (
                              <button
                                type="button"
                                onClick={() => setDialog({ kind: 'cancel', change: h })}
                                aria-label={`Cancel change: ${PRICE_LABEL[h.kind].toLowerCase()} to ${usd(h.amountUsdCents)}`}
                                className="px-3 py-1.5 rounded-xl text-xs font-medium bg-red-600/20 text-red-300 border border-red-500/30
                                  hover:bg-red-600/30 focus:outline-none focus:ring-2 focus:ring-primary-500
                                  focus:ring-offset-2 focus:ring-offset-dark-800"
                              >
                                Cancel change…
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {dialog.kind === 'set' && data && (
        <AdminSetPriceDialog open kind={dialog.price} current={data.current} onClose={() => setDialog({ kind: 'none' })} onDone={closeAndReload} />
      )}
      {dialog.kind === 'cancel' && data && (
        <AdminCancelPriceDialog
          open
          change={dialog.change}
          currentCents={data.current[dialog.change.kind]}
          onClose={() => setDialog({ kind: 'none' })}
          onDone={closeAndReload}
        />
      )}
    </div>
  );
};
