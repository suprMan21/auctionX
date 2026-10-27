/**
 * Loads the work-queue counts (see lib/workQueues.ts) for the queues this admin
 * may act on, refreshes them every minute and when the tab comes back.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { adminApi } from '../api/adminApi';
import { canOpenApprovals, hasPermission, PERMISSIONS, useAdminRole } from '../lib/adminRole';
import { EMPTY_WORK_QUEUES, WORK_QUEUE_REFRESH_MS, WorkQueueContext, type WorkQueueCounts } from '../lib/workQueues';

const countOrNull = (load: () => Promise<number>): Promise<number | null> =>
  Promise.resolve().then(load).catch(() => null);

export const WorkQueueProvider = ({ children }: { children: ReactNode }) => {
  const access = useAdminRole();
  const canReissue = hasPermission(access, PERMISSIONS.manageNfc);
  const canStuck = hasPermission(access, PERMISSIONS.reapplyPayments);
  const canApprovals = canOpenApprovals(access);
  const [counts, setCounts] = useState<Omit<WorkQueueCounts, 'refresh'>>(EMPTY_WORK_QUEUES);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!canReissue && !canStuck && !canApprovals) return;
    let cancelled = false;
    const load = () => {
      // A console left open in a background tab does not keep polling.
      if (document.visibilityState === 'hidden') return;
      void Promise.all([
        canReissue ? countOrNull(() => adminApi.listReissueRequests({ status: 'PENDING', limit: 1 }).then((r) => r.data.pagination.total)) : null,
        canReissue ? countOrNull(() => adminApi.listReissueRequests({ status: 'READY', limit: 1 }).then((r) => r.data.pagination.total)) : null,
        canStuck ? countOrNull(() => adminApi.listStuckPayments({ status: 'OPEN', limit: 1 }).then((r) => r.data.total)) : null,
        canApprovals ? countOrNull(() => adminApi.listApprovals({ status: 'waiting_for_me', limit: 1 }).then((r) => r.pagination.total)) : null,
      ]).then(([reissuesToReview, reissuesReady, stuckPayments, approvalsWaiting]) => {
        if (!cancelled) setCounts({ reissuesToReview, reissuesReady, stuckPayments, approvalsWaiting });
      });
    };
    load();
    const timer = setInterval(load, WORK_QUEUE_REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canReissue, canStuck, canApprovals, tick]);

  const value = useMemo(() => ({ ...counts, refresh }), [counts, refresh]);
  return <WorkQueueContext.Provider value={value}>{children}</WorkQueueContext.Provider>;
};
