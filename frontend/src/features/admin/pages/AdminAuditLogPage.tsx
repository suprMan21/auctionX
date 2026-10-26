/**
 * Admin audit log (S-ADMIN2 Ph1).
 * Filter by staff member, action, type and target; the dropdowns list values
 * that exist in the log, shown with plain-English labels. Details expands a row to show the recorded change and reason.
 * @module Module 10 — Admin Dashboard
 */

import { isTimeRange, TIME_RANGES, timeRangeOf, type TimeRangeValue } from '../lib/timeRange';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import type { AuditFacets, AuditLogEntry, AuditLogList } from '../api/accountSchemas';
import { errorMessage, formatWhen, loadFailed, shortId } from '../lib/display';
import { auditActionLabel, auditEntityLabel } from '../lib/labels';
import { AdminTable, Wrap, type AdminColumn } from '../components/AdminTable';
import { AdminPagination, ListState } from '../components/AdminListParts';

const SELECT_CLASS =
  'min-h-[44px] px-3 py-2 rounded-xl bg-dark-700 text-white border border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500';

const AuditDetail = ({ log }: { log: AuditLogEntry }) => (
  <div className="space-y-2">
    <p className="text-xs text-gray-400">Target ID: <span className="font-mono break-all">{log.entity_id}</span></p>
    {log.changes ? (
      <>
        <p className="text-xs text-gray-400">Recorded change</p>
        <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(log.changes, null, 2)}</pre>
      </>
    ) : (
      <p className="text-xs text-gray-400">No change data recorded.</p>
    )}
    {log.reason && <p className="text-xs text-gray-300">Reason: {log.reason}</p>}
  </div>
);

export const AdminAuditLogPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [loaded, setLoaded] = useState<{ key: string; data: AuditLogList | null; error: string | null } | null>(null);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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

  const columns: ReadonlyArray<AdminColumn<AuditLogEntry>> = [
    { key: 'when', header: 'When', width: 180, className: 'text-xs text-gray-400', cell: (log) => formatWhen(log.created_at) },
    { key: 'staff', header: 'Staff member', width: 220, className: 'text-white', cell: (log) => <Wrap text={log.admin_email} /> },
    { key: 'action', header: 'Action', className: 'text-primary-300', cell: (log) => <span title={log.action}>{auditActionLabel(log.action)}</span> },
    { key: 'type', header: 'Type', className: 'text-xs text-gray-400', cell: (log) => <span title={log.entity_type}>{auditEntityLabel(log.entity_type)}</span> },
    { key: 'target', header: 'Target', className: 'text-xs text-gray-400 font-mono', cell: (log) => shortId(log.entity_id) },
    {
      key: 'details', header: 'Details', hideHeader: true, width: 100,
      cell: (log) => (
        <button
          type="button"
          onClick={() => toggle(log.log_id)}
          aria-expanded={expanded.has(log.log_id)}
          className="min-h-[44px] px-3 text-xs text-gray-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded"
        >
          {expanded.has(log.log_id) ? 'Hide' : 'Details'}
        </button>
      ),
    },
  ];

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

      <ListState loading={loading} error={error} empty={!result || result.logs.length === 0} emptyText="No audit entries match." what="audit entries">
        {result && (
          <div className="space-y-4">
            <AdminTable
              id="audit-log"
              label="Audit log"
              columns={columns}
              rows={result.logs}
              rowKey={(log) => log.log_id}
              rowDetail={(log) => (expanded.has(log.log_id) ? <AuditDetail log={log} /> : null)}
            />
            <AdminPagination page={result.pagination.page} pages={result.pagination.pages} onPage={(p) => set('page', String(p))} />
          </div>
        )}
      </ListState>
    </div>
  );
};
