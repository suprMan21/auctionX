/**
 * Admin Dashboard landing page.
 * Shows 4 stat cards, recent audit entries, and a system health indicator.
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/adminApi';
import { supabase } from '@/lib/supabase';
import type { AuditLog, HealthStatus } from '../types/admin';

interface DashboardStats {
  totalUsers: number;
  pendingModeration: number;
  activeListings: number;
  activeAuctions: number;
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
const AuditRow = ({ log }: { log: AuditLog }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-white/5 last:border-0">
    <div className="min-w-0">
      <p className="text-sm text-white font-medium truncate">{log.action.replace(/_/g, ' ')}</p>
      <p className="text-xs text-gray-500 truncate">
        {log.admin_email} · {log.entity_type} {log.entity_id.slice(0, 8)}…
      </p>
    </div>
    <time className="text-xs text-gray-500 flex-shrink-0">
      {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
    </time>
  </div>
);

/** Health indicator chip shown in the dashboard footer. */
const HealthChip = ({ health }: { health: HealthStatus | null | 'error' }) => {
  if (!health) return null;

  if (health === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-warning-500/20 text-warning-400">
        <span className="w-1.5 h-1.5 rounded-full bg-warning-400" />
        Health endpoint not available
      </span>
    );
  }

  const colorMap: Record<string, string> = {
    ok: 'bg-success-500/20 text-success-400',
    degraded: 'bg-warning-500/20 text-warning-400',
    down: 'bg-error-500/20 text-error-400',
  };

  const dotMap: Record<string, string> = {
    ok: 'bg-success-400',
    degraded: 'bg-warning-400',
    down: 'bg-error-400',
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
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentLogs, setRecentLogs] = useState<AuditLog[]>([]);
  const [health, setHealth] = useState<HealthStatus | null | 'error'>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [usersRes, moderationRes, listingsRes, auctionsRes, logsRes] = await Promise.all([
          adminApi.listUsers({ limit: 1 }),
          adminApi.getModerationQueue({ status: 'pending' }),
          supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'ACTIVE'),
          supabase
            .from('auctions')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'ACTIVE'),
          adminApi.getAuditLogs({ limit: 10 }),
        ]);

        setStats({
          totalUsers: usersRes.pagination.total,
          pendingModeration: moderationRes.stats.pendingCount,
          activeListings: listingsRes.count ?? 0,
          activeAuctions: auctionsRes.count ?? 0,
        });

        setRecentLogs(logsRes.logs);

        // Health is optional — graceful 404 handling
        adminApi.getHealth()
          .then(setHealth)
          .catch(() => setHealth('error'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-6 border border-error-500/30">
        <p className="text-error-400 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Platform overview</p>
      </div>

      {/* Stat cards */}
      <div data-testid="stats-cards" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={stats?.totalUsers ?? 0} to="/admin/users" />
        <StatCard label="Pending Moderation" value={stats?.pendingModeration ?? 0} to="/admin/moderation" />
        <StatCard label="Active Listings" value={stats?.activeListings ?? 0} to="/admin/moderation" />
        <StatCard label="Active Auctions" value={stats?.activeAuctions ?? 0} to="/admin/audit-logs" />
      </div>

      {/* Recent audit logs */}
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

        {recentLogs.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity.</p>
        ) : (
          <div>
            {recentLogs.map((log) => (
              <AuditRow key={log.log_id} log={log} />
            ))}
          </div>
        )}
      </div>

      {/* Health indicator */}
      {health !== null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">System status:</span>
          <HealthChip health={health} />
        </div>
      )}
    </div>
  );
};
