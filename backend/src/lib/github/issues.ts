/**
 * GitHub Issues for the debug team — S-ADMIN1 Ph3a.
 *
 * A stuck payment opens ONE issue on the app repo; a repeat or a resolution
 * comments on it (Locked 2026-10-03: "GitHub Issues are the debug ticket").
 *
 * Rules:
 *   - IDs only. Nothing here may carry an email, a name, a UID or free text
 *     from a user. Callers pass a fixed set of fields; this file builds the text.
 *   - Never throws and never blocks a payment path. Without a token it logs
 *     once per call and returns null.
 *
 * Config (App Runner env, literals):
 *   GITHUB_ISSUES_TOKEN  fine-grained token, Issues: read and write, this repo only
 *   GITHUB_ISSUES_REPO   owner/name, default suprMan21/auctionX
 */

import { log } from '../logger';

const DEFAULT_REPO = 'suprMan21/auctionX';
const API = 'https://api.github.com';
const TIMEOUT_MS = 8000;

export const STUCK_PAYMENT_LABEL = 'stuck-payment';

export interface IssueRef {
  readonly number: number;
  readonly url: string;
}

const repo = (): string => {
  const raw = process.env.GITHUB_ISSUES_REPO?.trim();
  return raw && /^[\w.-]+\/[\w.-]+$/.test(raw) ? raw : DEFAULT_REPO;
};

export const isGithubIssuesConfigured = (): boolean => !!process.env.GITHUB_ISSUES_TOKEN?.trim();

const call = async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
  const token = process.env.GITHUB_ISSUES_TOKEN?.trim();
  if (!token) {
    log.warn('github_issues_not_configured', {});
    return null;
  }

  try {
    const res = await fetch(`${API}/repos/${repo()}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'authentic-materials-backend',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      // The status is enough to act on; the response body is not logged.
      log.error('github_issue_call_failed', { path: path.replace(/\d+/g, ':n'), status: res.status });
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    log.error('github_issue_call_failed', {
      path: path.replace(/\d+/g, ':n'),
      error: err instanceof Error ? err.name : 'unknown',
    });
    return null;
  }
};

export const ANCHORING_LABEL = 'anchoring';

export const createIssue = async (
  title: string,
  body: string,
  labels: readonly string[] = [STUCK_PAYMENT_LABEL],
): Promise<IssueRef | null> => {
  const data = await call('/issues', { title, body, labels: [...labels] });
  if (!data || typeof data.number !== 'number' || typeof data.html_url !== 'string') return null;
  return { number: data.number, url: data.html_url };
};

export const commentOnIssue = async (issueNumber: number, body: string): Promise<boolean> => {
  const data = await call(`/issues/${issueNumber}/comments`, { body });
  return data !== null;
};
