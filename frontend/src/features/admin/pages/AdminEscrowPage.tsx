import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { adminApi } from '../api/adminApi';
import type {
  EscrowSettlement,
  EscrowReconciliationLog,
  EscrowSummaryResponse,
} from '../api/adminApi';

const STATUS_OPTIONS = [
  { label: 'Escrow Hold', value: 'ESCROW_HOLD' },
  { label: 'Disputed', value: 'DISPUTED' },
  { label: 'Released', value: 'RELEASED' },
  { label: 'Refunded', value: 'REFUNDED' },
  { label: 'Cancelled', value: 'CANCELLED' },
  { label: 'All', value: '' },
] as const;

const STATUS_BADGE: Record<string, string> = {
  ESCROW_HOLD: 'bg-blue-500/20 text-blue-300',
  DISPUTED: 'bg-yellow-500/20 text-yellow-300',
  RELEASED: 'bg-emerald-500/20 text-emerald-300',
  REFUNDED: 'bg-orange-500/20 text-orange-300',
  CANCELLED: 'bg-gray-500/20 text-gray-300',
  PENDING_PAYMENT: 'bg-purple-500/20 text-purple-300',
};

const fmt = (cents: number | null | undefined) =>
  `$${((cents ?? 0) / 100).toFixed(2)}`;

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

const SummaryCard = ({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'purple' | 'yellow' | 'green';
}) => {
  const accentClass =
    accent === 'yellow'
      ? 'text-yellow-400'
      : accent === 'green'
        ? 'text-emerald-400'
        : 'text-white';
  return (
    <div className="glass rounded-2xl p-5">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accentClass}`}>{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
};

const FilterPills = ({
  active,
  onChange,
}: {
  active: string;
  onChange: (v: string) => void;
}) => (
  <div className="flex gap-2 flex-wrap">
    {STATUS_OPTIONS.map((opt) => (
      <button
        key={opt.value || 'all'}
        onClick={() => onChange(opt.value)}
        className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors
          focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800
          ${
            active === opt.value
              ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
              : 'bg-dark-700 text-gray-400 hover:text-white hover:bg-dark-600'
          }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const ReconciliationLogRow = ({ log }: { log: EscrowReconciliationLog }) => (
  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 sm:gap-4 py-2 border-b border-white/5 last:border-b-0 text-sm">
    <span className="text-gray-400 sm:col-span-1">
      {new Date(log.run_at).toLocaleString()}
    </span>
    <span className="text-gray-300 sm:col-span-1">
      Checked: <span className="text-white">{log.total_checked}</span>
    </span>
    <span className="text-blue-300 sm:col-span-1">
      Released: {log.stuck_released}
    </span>
    <span className="text-yellow-300 sm:col-span-1">
      Orphaned: {log.orphaned_flagged}
    </span>
    <span className="text-orange-300 sm:col-span-1">
      Aged disputes: {log.disputed_aged}
    </span>
  </div>
);

export const AdminEscrowPage = () => {
  const [summary, setSummary] = useState<EscrowSummaryResponse['data'] | null>(null);
  const [settlements, setSettlements] = useState<EscrowSettlement[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('ESCROW_HOLD');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const limit = 25;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, listRes] = await Promise.all([
        adminApi.getEscrowSummary(),
        adminApi.listEscrowSettlements({ status: statusFilter || undefined, page, limit }),
      ]);
      setSummary(summaryRes.data);
      setSettlements(listRes.data.settlements);
      setTotal(listRes.data.total);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load escrow data';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, page]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleRelease = async (settlementId: string) => {
    if (
      !confirm(
        `Manually release escrow for settlement ${settlementId.slice(0, 8)}…? A payout row will be created for the seller.`,
      )
    ) {
      return;
    }
    setReleasing(settlementId);
    try {
      const result = await adminApi.manualReleaseEscrow(settlementId);
      toast.success(
        result.payoutCreated
          ? 'Settlement released and payout created'
          : 'Settlement released — payout insert failed (review manually)',
      );
      await fetchAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Release failed');
    } finally {
      setReleasing(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Escrow Reconciliation</h1>
        <p className="text-gray-400 text-sm mt-1">
          Watchdog runs daily at 02:00 UTC. Stuck escrows are auto-released; orphans
          flag super-admins; aged disputes surface here for resolution.
        </p>
      </div>

      {error && (
        <div className="glass rounded-2xl p-4 border border-red-500/40 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            label="In Escrow"
            value={String(summary.escrowHold.count)}
            sub={`${fmt(summary.escrowHold.totalCents)} held`}
          />
          <SummaryCard
            label="Disputed"
            value={String(summary.disputed.count)}
            sub="pending resolution"
            accent="yellow"
          />
          <SummaryCard
            label="Released (30d)"
            value={fmt(summary.released30d.totalCents)}
            sub="settled to sellers"
            accent="green"
          />
        </div>
      )}

      {/* Recent reconciliation runs */}
      {summary && summary.recentReconciliationLogs.length > 0 && (
        <div className="glass rounded-2xl p-5">
          <h2 className="text-white font-semibold mb-3">Recent Reconciliation Runs</h2>
          <div className="space-y-1">
            {summary.recentReconciliationLogs.map((log) => (
              <ReconciliationLogRow key={log.run_at} log={log} />
            ))}
          </div>
        </div>
      )}

      {/* Settlement list */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row mb-4">
          <h2 className="text-white font-semibold">Settlements</h2>
          <FilterPills
            active={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          />
        </div>

        {loading ? (
          <div className="text-gray-400 text-sm py-8 text-center">Loading…</div>
        ) : settlements.length === 0 ? (
          <div className="text-gray-400 text-sm py-8 text-center">
            No settlements found for this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-left border-b border-white/10">
                  <th className="pb-2 pr-4 font-medium">ID</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Gross</th>
                  <th className="pb-2 pr-4 font-medium">Net</th>
                  <th className="pb-2 pr-4 font-medium">Escrow Ends</th>
                  <th className="pb-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((s) => (
                  <tr
                    key={s.id}
                    className="border-b border-white/5 hover:bg-white/[0.03]"
                  >
                    <td className="py-2 pr-4 text-gray-300 font-mono text-xs">
                      {s.id.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[s.status] ?? 'bg-gray-500/20 text-gray-300'}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-white">{fmt(s.gross_amount_cents)}</td>
                    <td className="py-2 pr-4 text-emerald-400">
                      {fmt(s.net_amount_cents)}
                    </td>
                    <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                      {fmtDate(s.escrow_ends_at)}
                    </td>
                    <td className="py-2">
                      {(s.status === 'ESCROW_HOLD' || s.status === 'DISPUTED') && (
                        <button
                          onClick={() => handleRelease(s.id)}
                          disabled={releasing === s.id}
                          className="px-3 py-1 rounded-xl text-xs font-medium bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                          {releasing === s.id ? 'Releasing…' : 'Manual Release'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-gray-400">
              Page {page} of {totalPages} · {total} total
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || loading}
                className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-400 hover:text-white disabled:opacity-40"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || loading}
                className="px-3 py-1.5 rounded-xl bg-dark-700 text-gray-400 hover:text-white disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
