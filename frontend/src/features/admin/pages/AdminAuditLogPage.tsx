/**
 * Admin audit log (S-ADMIN2 Ph1).
 * Filter by staff member, action, type and target; the dropdowns list values
 * that exist in the log, shown with plain-English labels. Rows expand to show the recorded change and reason.
 * @module Module 10 — Admin Dashboard
 */

import { isTimeRange, TIME_RANGES, timeRangeOf, type TimeRangeValue } from '../lib/timeRange';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AuditFacets, AuditLogEntry, AuditLogList } from '../api/accountSchemas';
import { errorMessage, formatWhen, loadFailed, shortId } from '../lib/display';
import { auditActionLabel, auditEntityLabel } from '../lib/labels';

const SELECT_CLASS =
  'min-h-[44px] px-3 py-2 rounded-xl bg-dark-700 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500';

const Pagination = ({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) => {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page === 1}
        className="min-h-[44px] px-3 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        Previous
      </button>
      <span className="text-sm text-gray-400">Page {page} of {pages}</span>
      <button type="button" onClick={() => onPage(page + 1)} disabled={page === pages}
        className="min-h-[44px] px-3 rounded-xl text-sm text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
        Next
      </button>
    </div>
  );
};

const AuditRow = ({ log }: { log: AuditLogEntry }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="bg-dark-800 hover:bg-dark-700 transition-colors">
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{formatWhen(log.created_at)}</td>
        <td className="px-4 py-3 text-sm text-white max-w-[200px] truncate">{log.admin_email}</td>
        <td className="px-4 py-3 text-sm text-primary-300" title={log.action}>{auditActionLabel(log.action)}</td>
        <td className="px-4 py-3 text-xs text-gray-400" title={log.entity_type}>{auditEntityLabel(log.entity_type)}</td>
        <td className="px-4 py-3 text-xs text-gray-400 font-mono">{shortId(log.entity_id)}</td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="min-h-[44px] px-3 text-xs text-gray-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-dark-700">
          <td colSpan={6} className="px-6 py-4 space-y-2">
            <p className="text-xs text-gray-400">Target ID: <span className="font-mono">{log.entity_id}</span></p>
            {log.changes ? (
              <>
              <p className="text-xs text-gray-400">Recorded change</p>
              <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(log.changes, null, 2)}</pre>
              </>
            ) : (
              <p className="text-xs text-gray-400">No change data recorded.</p>
            )}
            {log.reason && <p className="text-xs text-gray-300">Reason: {log.reason}</p>}
          </td>
        </tr>
      )}
    </>
  );
};

export const AdminAuditLogPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState<{ key: string; data: AuditLogList | null; error: string | null } | null>(null);
  const [facets, setFacets] = useState<AuditFacets | null>(null);

  const admin = searchParams.get('admin') ?? '';
  const action = searchParams.get('action') ?? '';
  const entity = searchParams.get('entity') ?? '';
  const target = searchParams.get('target') ?? '';
  const rawWhen = searchParams.get('when') ?? '';
  const when: TimeRangeValue = isTimeRange(rawWhen) ? rawWhen : '';
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);

  useEffect(() => {
    adminApi.getAuditFacets().then(setFacets).catch(() => setFacets({ actions: [], entity_types: [], actors: [] }));
  }, []);

  const queryKey = `${admin}|${action}|${entity}|${target}|${when}|${page}`;
  useEffect(() => {
    let cancelled = false;
    adminApi
      .getAuditLogs({
        page, limit: 50, admin: admin || undefined, action: action || undefined,
        entity: entity || undefined, target: target || undefined, ...timeRangeOf(when),
      })
      .then((data) => { if (!cancelled) setLoaded({ key: queryKey, data, error: null }); })
      .catch((err: unknown) => {
        if (!cancelled) setLoaded({ key: queryKey, data: null, error: errorMessage(err, loadFailed('Audit entries')) });
      });
    return () => { cancelled = true; };
  }, [admin, action, entity, target, when, page, queryKey]);
  const loading = loaded?.key !== queryKey;
  const result = loading ? null : loaded?.data ?? null;
  const error = loading ? null : loaded?.error ?? null;

  const set = (key: string, value: string) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.set('page', '1');
      return next;
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Audit log</h1>
        {result && <p className="text-gray-400 text-sm mt-1">{result.pagination.total.toLocaleString()} entries</p>}
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
        <label>
          <span className="sr-only">Filter by time</span>
          <select value={when} onChange={(e) => set('when', e.target.value)} className={SELECT_CLASS}>
            {TIME_RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by staff member</span>
          <select value={admin} onChange={(e) => set('admin', e.target.value)} className={SELECT_CLASS}>
            <option value="">All staff</option>
            {facets?.actors.map((a) => <option key={a.admin_id} value={a.admin_id}>{a.email}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by action</span>
          <select value={action} onChange={(e) => set('action', e.target.value)} className={SELECT_CLASS}>
            <option value="">All actions</option>
            {facets?.actions.map((a) => <option key={a} value={a}>{auditActionLabel(a)}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by type</span>
          <select value={entity} onChange={(e) => set('entity', e.target.value)} className={SELECT_CLASS}>
            <option value="">All types</option>
            {facets?.entity_types.map((t) => <option key={t} value={t}>{auditEntityLabel(t)}</option>)}
          </select>
        </label>
        {target && (
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <span>Target ID <span className="font-mono">{shortId(target)}</span></span>
            <button type="button" onClick={() => set('target', '')}
              className="min-h-[44px] px-3 rounded-xl bg-dark-700 hover:bg-dark-600 text-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="glass rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48" role="status" aria-label="Loading audit entries">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <p className="p-6 text-error-500 text-sm" role="alert">{error}</p>
        ) : !result || result.logs.length === 0 ? (
          <p className="p-6 text-gray-400 text-sm">No audit entries match.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-dark-700 border-b border-white/10">
                  <tr>
                    {['When', 'Staff member', 'Action', 'Type', 'Target', ''].map((h, i) => (
                      <th key={h || i} scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {result.logs.map((log) => <AuditRow key={log.log_id} log={log} />)}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-white/10">
              <Pagination page={result.pagination.page} pages={result.pagination.pages} onPage={(p) => set('page', String(p))} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
