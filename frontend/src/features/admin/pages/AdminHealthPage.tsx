/**
 * Admin system health page.
 * Polls GET /admin/health every 30s and displays component status.
 * Handles gracefully when the endpoint is not yet deployed (404).
 * @module Module 10 — Admin Dashboard
 */

import { useEffect, useRef, useState } from 'react';
import { adminApi } from '../api/adminApi';
import type { HealthStatus, HealthComponent } from '../types/admin';

const POLL_INTERVAL_MS = 30_000;

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Overall status chip. */
const StatusChip = ({ status }: { status: 'ok' | 'degraded' | 'down' }) => {
  const map = {
    ok: { label: 'Operational', cls: 'bg-success-500/20 text-success-400', dot: 'bg-success-400' },
    degraded: { label: 'Degraded', cls: 'bg-warning-500/20 text-warning-400', dot: 'bg-warning-400' },
    down: { label: 'Down', cls: 'bg-error-500/20 text-error-400', dot: 'bg-error-400' },
  };
  const { label, cls, dot } = map[status];

  return (
    <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${cls}`}>
      <span className={`w-2 h-2 rounded-full ${dot} animate-pulse`} />
      {label}
    </span>
  );
};

/** A single component health row. */
const ComponentRow = ({ name, component }: { name: string; component: HealthComponent }) => {
  const colorMap = {
    ok: 'text-success-400',
    degraded: 'text-warning-400',
    down: 'text-error-400',
  };

  return (
    <div className="flex items-center justify-between py-3 border-b border-white/5 last:border-0">
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          component.status === 'ok' ? 'bg-success-400' : component.status === 'degraded' ? 'bg-warning-400' : 'bg-error-400'
        }`} />
        <span className="text-white text-sm capitalize">{name.replace(/_/g, ' ')}</span>
      </div>
      <div className="flex items-center gap-4 text-right">
        {component.latencyMs != null && (
          <span className="text-xs text-gray-400">{component.latencyMs}ms</span>
        )}
        <span className={`text-sm font-medium ${colorMap[component.status]}`}>
          {component.status}
        </span>
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

/**
 * AdminHealthPage — live system health with auto-refresh every 30s.
 */
export const AdminHealthPage = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [notDeployed, setNotDeployed] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const data = await adminApi.getHealth();
      setHealth(data);
      setNotDeployed(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('404') || msg.includes('not found') || msg.includes('HTTP 404')) {
        setNotDeployed(true);
      } else {
        setNotDeployed(true);
      }
    } finally {
      setLoading(false);
      setLastFetched(new Date());
      setCountdown(POLL_INTERVAL_MS / 1000);
    }
  };

  // Polling
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetchHealth();
    pollRef.current = setInterval(fetchHealth, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Countdown tick
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const componentEntries = health?.components
    ? (Object.entries(health.components) as [string, HealthComponent][])
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">System Health</h1>
          {lastFetched && (
            <p className="text-gray-400 text-sm mt-1">
              Last checked: {lastFetched.toLocaleTimeString()} · Refreshing in {countdown}s
            </p>
          )}
        </div>
        <button
          onClick={() => { setLoading(true); fetchHealth(); }}
          className="px-4 py-2 rounded-xl bg-primary-500/20 text-primary-400 hover:bg-primary-500/30 transition-colors text-sm font-medium
                     focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 focus:ring-offset-dark-800"
        >
          Refresh now
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : notDeployed ? (
        <div className="glass rounded-2xl p-6 border border-warning-500/30">
          <div className="flex items-center gap-3 mb-3">
            <svg className="w-5 h-5 text-warning-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-warning-400 font-semibold">Health endpoint not deployed</h2>
          </div>
          <p className="text-gray-400 text-sm">
            The <code className="text-warning-300 bg-dark-700 px-1 py-0.5 rounded">GET /admin/health</code> endpoint
            returned an error. This endpoint may not yet be deployed on the backend.
          </p>
        </div>
      ) : health ? (
        <>
          {/* Overall status */}
          <div className="glass rounded-2xl p-6 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-gray-400 text-sm mb-2">Overall status</p>
              <StatusChip status={health.status} />
            </div>
            {health.timestamp && (
              <p className="text-xs text-gray-500">
                Server time: {new Date(health.timestamp).toLocaleString()}
              </p>
            )}
          </div>

          {/* Component breakdown */}
          {componentEntries.length > 0 && (
            <div className="glass rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-white mb-4">Components</h2>
              <div>
                {componentEntries.map(([name, component]) => (
                  <ComponentRow key={name} name={name} component={component} />
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
};
