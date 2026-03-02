/**
 * Admin audit log page.
 * Paginated table of admin actions with expandable JSON details and filters.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AuditLog, AuditLogsResponse } from '../types/admin';

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Pagination row — same pattern as AdminUsersPage. */
const Pagination = ({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (p: number) => void;
}) => {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page === 1}
        className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        ← Prev
      </button>
      <span className="text-sm text-gray-400">Page {page} of {pages}</span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page === pages}
        className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Next →
      </button>
    </div>
  );
};

/** Expandable audit log row. */
const AuditRow = ({ log }: { log: AuditLog }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded((v) => !v)}
        className="bg-dark-800 hover:bg-dark-700 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
        </td>
        <td className="px-4 py-3 text-sm text-white max-w-[160px] truncate">{log.admin_email}</td>
        <td className="px-4 py-3 text-sm text-primary-400">{log.action.replace(/_/g, ' ')}</td>
        <td className="px-4 py-3 text-xs text-gray-400">{log.entity_type}</td>
        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{log.entity_id.slice(0, 12)}…</td>
        <td className="px-4 py-3 text-xs text-gray-400">{log.brand}</td>
        <td className="px-4 py-3 text-right text-xs text-gray-500">{expanded ? '▲' : '▼'}</td>
      </tr>

      {expanded && (
        <tr className="bg-dark-700">
          <td colSpan={7} className="px-6 py-4">
            {log.changes ? (
              <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(log.changes, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-gray-500">No change data recorded.</p>
            )}
            {log.reason && (
              <p className="text-xs text-gray-400 mt-2">Reason: {log.reason}</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminAuditLogPage — filterable, paginated table of admin actions.
 */
export const AdminAuditLogPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const actionFilter = searchParams.get('action') ?? '';
  const entityFilter = searchParams.get('entity') ?? '';

  const [result, setResult] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Local filter inputs (not yet synced) — sync on submit
  const [actionInput, setActionInput] = useState(actionFilter);
  const [entityInput, setEntityInput] = useState(entityFilter);

  useEffect(() => {
    setLoading(true);
    setError(null);
    adminApi
      .getAuditLogs({
        page,
        action: actionFilter || undefined,
        entity: entityFilter || undefined,
      })
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load logs'))
      .finally(() => setLoading(false));
  }, [page, actionFilter, entityFilter]);

  const applyFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (actionInput) next.set('action', actionInput); else next.delete('action');
      if (entityInput) next.set('entity', entityInput); else next.delete('entity');
      next.set('page', '1');
      return next;
    });
  };

  const clearFilters = () => {
    setActionInput('');
    setEntityInput('');
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('action');
      next.delete('entity');
      next.set('page', '1');
      return next;
    });
  };

  const handlePage = (p: number) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(p));
      return next;
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit Logs</h1>
        {result && (
          <p className="text-gray-400 text-sm mt-1">{result.pagination.total.toLocaleString()} entries</p>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          placeholder="Filter by action…"
          className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
                     border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        />
        <input
          type="text"
          value={entityInput}
          onChange={(e) => setEntityInput(e.target.value)}
          placeholder="Filter by entity type…"
          className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-dark-700 text-white placeholder:text-gray-500
                     border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        />
        <button
          onClick={applyFilters}
          className="min-h-[44px] px-6 rounded-xl bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 transition-colors text-sm font-medium
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Apply
        </button>
        {(actionFilter || entityFilter) && (
          <button
            onClick={clearFilters}
            className="min-h-[44px] px-4 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-colors text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="p-6">
            <p className="text-error-400 text-sm">{error}</p>
          </div>
        ) : !result || result.logs.length === 0 ? (
          <div className="p-6">
            <p className="text-gray-500 text-sm">No audit log entries found.</p>
          </div>
        ) : (
          <>
            <p className="px-4 pt-3 text-xs text-gray-500">Click a row to expand change details.</p>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700 border-b border-white/10">
                  <tr>
                    {['Timestamp', 'Admin', 'Action', 'Entity Type', 'Entity ID', 'Brand', ''].map((h) => (
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
                  {result.logs.map((log) => (
                    <AuditRow key={log.log_id} log={log} />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-white/10">
              <Pagination page={result.pagination.page} pages={result.pagination.pages} onPage={handlePage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
