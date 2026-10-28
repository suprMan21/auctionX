import { createIssue } from '../github/issues';
import { log } from '../logger';

/**
 * Early-access alerts (no third party: a GitHub Issue, like stuck payments).
 * Counts only: never an email address or anything a visitor typed.
 *
 *  - Spike: signups in the last hour reach EARLY_ACCESS_SPIKE_PER_HOUR (default 50).
 *  - Failing: the database refuses signups (on staging this is usually the free-plan
 *    auto-pause; restore the project, then check `supabase projects list`).
 *
 * At most one issue per kind per cool-off window, per instance.
 */

export const EARLY_ACCESS_LABEL = 'early-access';
const SPIKE_COOLOFF_MS = 6 * 60 * 60 * 1000;
const FAILING_COOLOFF_MS = 60 * 60 * 1000;

const lastSent: Record<'spike' | 'failing', number> = { spike: 0, failing: 0 };

export const spikeThreshold = (): number => {
  const n = Number(process.env.EARLY_ACCESS_SPIKE_PER_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 50;
};

const due = (kind: 'spike' | 'failing', now: number, coolOff: number): boolean => {
  if (now - lastSent[kind] < coolOff) return false;
  lastSent[kind] = now;
  return true;
};

/** Call after a new signup with the count for the last hour. */
export const maybeAlertSpike = async (lastHour: number, now: number = Date.now()): Promise<boolean> => {
  if (lastHour < spikeThreshold() || !due('spike', now, SPIKE_COOLOFF_MS)) return false;
  log.warn('early_access_spike', { last_hour: lastHour, threshold: spikeThreshold() });
  await createIssue(
    `Early-access signup spike: ${lastHour} in the last hour`,
    [
      `Signups in the last hour: **${lastHour}** (alert at ${spikeThreshold()}).`,
      '',
      'Could be a launch moment or a bot run. Check the `waitlist_signups` rows from the last hour for',
      'clusters of similar addresses or domains. Per-IP limits and proof-of-work are on; lower the global',
      'limit (EARLY_ACCESS_GLOBAL_PER_HOUR) if it is a bot run.',
    ].join('\n'),
    [EARLY_ACCESS_LABEL],
  );
  return true;
};

/** Call when the database refuses a signup. */
export const maybeAlertFailing = async (errorCode: string, now: number = Date.now()): Promise<boolean> => {
  if (!due('failing', now, FAILING_COOLOFF_MS)) return false;
  await createIssue(
    'Early-access signups are failing',
    [
      `The database refused an early-access signup (code \`${errorCode}\`). People see "Something went wrong".`,
      '',
      'On staging this is usually the free-plan auto-pause: run `supabase projects list`, restore the project',
      'if it is paused, then sign up once from the homepage to confirm.',
    ].join('\n'),
    [EARLY_ACCESS_LABEL],
  );
  return true;
};

/** Tests only. */
export const resetAlertsForTest = (): void => {
  lastSent.spike = 0;
  lastSent.failing = 0;
};
