/**
 * Admin Dashboard landing page.
 * Shows 4 stat cards, recent audit entries, and a system health indicator.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { supabase } from '@/lib/supabase';
import type { HealthStatus } from '../types/admin';
import type { AuditLogEntry } from '../api/accountSchemas';
import { hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { isMarketplaceEnabledOnClient } from '@/lib/featureFlags';

/** Settles to null instead of throwing, so one failed panel does not blank the dashboard. */
const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

interface DashboardStats {
  totalUsers: number | null;
  pendingModeration: number | null;
  activeListings: number | null;
  activeAuctions: number | null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** A single stat card on the dashboard. */
const StatCard = ({
  label,
  value,
  to,
}: {
  label: string;
  value: number | string;
  to: string;
}) => (
  <Link
    to={to}
    className="glass rounded-2xl p-6 flex flex-col gap-2 hover:bg-white/5 transition-colors
               focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
  >
    <span className="text-3xl font-bold text-white">{value}</span>
    <span className="text-sm text-gray-400">{label}</span>
  </Link>
);

/** A single row in the recent audit log list. */
const AuditRow = ({ log }: { log: AuditLogEntry }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-white/5 last:border-0">
    <div className="min-w-0">
      <p className="text-sm text-white font-medium truncate">{log.action.replace(/_/g, ' ')}</p>
      <p className="text-xs text-gray-400 truncate">
        {log.admin_email} · {log.entity_type} {log.entity_id.slice(0, 8)}…
      </p>
    </div>
    <time className="text-xs text-gray-400 flex-shrink-0">
      {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
    </time>
  </div>
);

/** Health indicator chip shown in the dashboard footer. */
const HealthChip = ({ health }: { health: HealthStatus | null | 'error' }) => {
  if (!health) return null;

  if (health === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-warning-500/20 text-warning-500">
        <span className="w-1.5 h-1.5 rounded-full bg-warning-500" />
        Health endpoint not available
      </span>
    );
  }

  const colorMap: Record<string, string> = {
    ok: 'bg-success-500/20 text-success-500',
    degraded: 'bg-warning-500/20 text-warning-500',
    down: 'bg-error-500/20 text-error-500',
  };

  const dotMap: Record<string, string> = {
    ok: 'bg-success-500',
    degraded: 'bg-warning-500',
    down: 'bg-error-500',
  };

  return (
    <Link
      to="/admin/health"
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${colorMap[health.status] ?? 'bg-gray-500/20 text-gray-400'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[health.status] ?? 'bg-gray-400'}`} />
      System {health.status}
    </Link>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminDashboardPage — aggregates platform stats for the admin overview.
 */
export const AdminDashboardPage = () => {
  const access = useAdminRole();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLogEntry[] | null>(null);
  const [health, setHealth] = useState<HealthStatus | null | 'error'>(null);

  const canViewUsers = hasPermission(access, PERMISSIONS.viewUsers);
  const canViewAudit = hasPermission(access, PERMISSIONS.viewAuditLogs);
  // The marketplace is parked: its endpoints are not mounted, so do not call them.
  const marketplace = isMarketplaceEnabledOnClient();

  useEffect(() => {
    if (access.status !== 'known') return;
    let cancelled = false;
    const count = (table: 'listings' | 'auctions') =>
      Promise.resolve(supabase.from(table).select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'))
        .then((r) => (r.error ? null : r.count ?? 0));

    void Promise.all([
      canViewUsers ? orNull(adminApi.searchAccounts({ limit: 1 }).then((r) => r.pagination.total)) : null,
      marketplace ? orNull(adminApi.getModerationQueue({ status: 'pending' }).then((r) => r.stats.pendingCount)) : null,
      marketplace ? orNull(count('listings')) : null,
      marketplace ? orNull(count('auctions')) : null,
      canViewAudit ? orNull(adminApi.getAuditLogs({ limit: 10 }).then((r) => r.logs)) : null,
    ]).then(([totalUsers, pendingModeration, activeListings, activeAuctions, logs]) => {
      if (cancelled) return;
      setStats({ totalUsers, pendingModeration, activeListings, activeAuctions });
      setRecentLogs(logs);
    });

    adminApi.getHealth()
      .then((h) => { if (!cancelled) setHealth(h); })
      .catch(() => { if (!cancelled) setHealth('error'); });
    return () => { cancelled = true; };
  }, [access.status, canViewUsers, canViewAudit, marketplace]);

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="Loading dashboard">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const shown = (v: number | null) => (v === null ? '—' : v);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Platform overview</p>
      </div>

      {/* Stat cards: only the ones this admin may open ("—" when a count could not be loaded) */}
      {(canViewUsers || marketplace) && (
        <div data-testid="stats-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {canViewUsers && <StatCard label="Total Users" value={shown(stats.totalUsers)} to="/admin/users" />}
          {marketplace && <StatCard label="Pending Moderation" value={shown(stats.pendingModeration)} to="/admin/moderation" />}
          {marketplace && <StatCard label="Active Listings" value={shown(stats.activeListings)} to="/admin/moderation" />}
          {marketplace && <StatCard label="Active Auctions" value={shown(stats.activeAuctions)} to="/admin/auctions" />}
        </div>
      )}

      {/* Recent audit logs */}
      {canViewAudit && (
      <div className="glass rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
          <Link
            to="/admin/audit-logs"
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            View all →
          </Link>
        </div>

        {recentLogs === null ? (
          <p className="text-error-500 text-sm" role="alert">Recent activity could not be loaded.</p>
        ) : recentLogs.length === 0 ? (
          <p className="text-gray-400 text-sm">No recent activity.</p>
        ) : (
          <div>
            {recentLogs.map((log) => (
              <AuditRow key={log.log_id} log={log} />
            ))}
          </div>
        )}
      </div>
      )}

      {/* Health indicator */}
      {health !== null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">System status:</span>
          <HealthChip health={health} />
        </div>
      )}
    </div>
  );
};
