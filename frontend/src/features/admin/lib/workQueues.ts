/**
 * Work waiting for staff: re-issues to review, re-issues ready for a new chip,
 * and stuck payments still open. Loaded once by the console layout (only the
 * queues this admin may act on), refreshed every minute and when the tab comes
 * back, and shared with the dashboard and the nav badges.
 */

import { createContext, useContext } from 'react';

/** undefined = still loading; null = not allowed or could not be loaded. */
export interface WorkQueueCounts {
  reissuesToReview: number | null | undefined;
  reissuesReady: number | null | undefined;
  stuckPayments: number | null | undefined;
  /** Reload the counts now (call after an action that changes a queue). */
  refresh: () => void;
}

export const EMPTY_WORK_QUEUES: WorkQueueCounts = { reissuesToReview: undefined, reissuesReady: undefined, stuckPayments: undefined, refresh: () => {} };
export const WORK_QUEUE_REFRESH_MS = 60_000;

export const WorkQueueContext = createContext<WorkQueueCounts>(EMPTY_WORK_QUEUES);

export const useWorkQueues = (): WorkQueueCounts => useContext(WorkQueueContext);
