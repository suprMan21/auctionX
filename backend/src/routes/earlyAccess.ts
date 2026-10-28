import express, { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ACCEPTED } from '../lib/earlyAccess/constants';
import { maybeAlertFailing, maybeAlertSpike } from '../lib/earlyAccess/alerts';
import type { DomainVerdict } from '../lib/earlyAccess/emailDomain';
import { handleSignup, type EarlyAccessStore } from '../lib/earlyAccess/signup';
import { createSupabaseStore, StoreError } from '../lib/earlyAccess/supabaseStore';
import { makeUnsubscribeToken, readUnsubscribeToken } from '../lib/earlyAccess/unsubscribeToken';
import { renderWelcomeEmail } from '../lib/earlyAccess/welcomeEmail';
import { log } from '../lib/logger';
import { sendEmail, type EmailPayload } from '../lib/notifications/emailSender';
import { hashEmailForLog } from '../lib/security/securityEvent';

/**
 * S-SITE2 G3 — early-access signup. The ONE network call the public site makes
 * (Decisions DB, Locked 2026-10-28). Mounted at /api/v1/early-access.
 *
 *   POST /                 signup (JSON). Same 202 reply for new, repeat and dropped requests.
 *   GET  /unsubscribe?t=   page with a confirm button (link scanners must not unsubscribe people).
 *   POST /unsubscribe?t=   the button, and RFC 8058 one-click from mail apps.
 *
 * Bot defences, no third party: honeypot, minimum fill time, per-IP + global rate
 * limits, proof-of-work bound to the email, MX + throwaway-domain check, spike alert.
 */

const apiBase = (): string =>
  (process.env.PUBLIC_API_URL ?? 'https://vw7zy9mkyg.us-east-2.awsapprunner.com').replace(/\/+$/, '');

export const unsubscribeUrl = (token: string): string =>
  `${apiBase()}/api/v1/early-access/unsubscribe?t=${encodeURIComponent(token)}`;

const MESSAGES = {
  INVALID_REQUEST: 'Check your email address and try again.',
  INVALID_CONSENT: 'Reload the page and try again.',
  BAD_POW: 'Reload the page and try again.',
  EMAIL_DISPOSABLE: 'Use an email address you keep. Throwaway inboxes miss the launch email.',
  EMAIL_NO_MAIL: "That email can't receive mail. Check it and try again.",
  RATE_LIMITED: 'Too many tries. Give it a few minutes and try again.',
  UNAVAILABLE: 'Something went wrong on our side. Try again in a minute.',
} as const;

const fail = (res: Response, status: number, code: keyof typeof MESSAGES) =>
  res.status(status).json({ success: false, data: null, error: { code, message: MESSAGES[code] } });

const SignupBody = z
  .object({
    email: z.string().trim().max(254).email(),
    consentText: z.string().max(500),
    website: z.string().max(200).default(''),
    fillMs: z.number().int().nonnegative().max(7 * 24 * 60 * 60 * 1000),
    pow: z.object({ ts: z.number().int(), nonce: z.string().max(16) }).strict(),
  })
  .strict();

export interface EarlyAccessDeps {
  store: EarlyAccessStore;
  send: (payload: EmailPayload) => Promise<boolean>;
  domainCheck?: (email: string) => Promise<DomainVerdict>;
  now?: () => Date;
  /** Per-IP and global limits (overridable for tests). */
  perIpPer10Min?: number;
  globalPerHour?: number;
}

const globalLimit = (): number => {
  const n = Number(process.env.EARLY_ACCESS_GLOBAL_PER_HOUR);
  return Number.isInteger(n) && n > 0 ? n : 300;
};

// ---------- Unsubscribe pages (plain HTML, no script, nothing loaded from elsewhere) ----------

const page = (title: string, body: string): string => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} | Authentic Materials</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070709;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
main{max-width:30rem;padding:2rem 1rem;text-align:center}
h1{font-size:1.75rem;letter-spacing:.03em;text-transform:uppercase;margin:0 0 1rem}
p{color:#C9CBD3;line-height:1.6}
button{min-height:48px;padding:0 1.75rem;border:0;border-radius:12px;background:#7C3AED;color:#fff;font:inherit;font-weight:700;cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid #A78BFA;outline-offset:3px}
a{color:#A78BFA}
</style></head><body><main>${body}</main></body></html>`;

const sendPage = (res: Response, status: number, html: string) => {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    .send(html);
};

const BAD_LINK = page(
  'Link not recognised',
  `<h1>That link didn't work</h1><p>It may be cut short. Use the Unsubscribe link in the email again, or write to
  <a href="mailto:hello@authentic-materials.com">hello@authentic-materials.com</a> and we'll take you off the list.</p>`,
);

const tokenFrom = (req: Request): unknown => req.query.t ?? (req.body as Record<string, unknown> | undefined)?.t;

// ---------- Router ----------

export const createEarlyAccessRouter = (deps: EarlyAccessDeps): Router => {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  const perIp = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: deps.perIpPer10Min ?? 5,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => fail(res, 429, 'RATE_LIMITED'),
  });
  const overall = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: deps.globalPerHour ?? globalLimit(),
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: () => 'early-access:global',
    handler: (_req, res) => {
      log.warn('early_access_global_limit', {});
      fail(res, 429, 'RATE_LIMITED');
    },
  });
  const unsubLimit = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  /** After the reply: welcome email + spike check. Never throws, never blocks the signup. */
  const afterSignup = async (id: string, email: string): Promise<void> => {
    const toHash = hashEmailForLog(email);
    try {
      const token = makeUnsubscribeToken(id);
      if (!token) {
        // CASL: no working unsubscribe, no email.
        log.error('early_access_welcome_skipped', { reason: 'unsubscribe_secret_missing', to_hash: toHash });
      } else {
        const mail = renderWelcomeEmail(unsubscribeUrl(token));
        const sent = await deps.send({ to: email, subject: mail.subject, html: mail.html, text: mail.text, headers: mail.headers });
        if (sent) await deps.store.markWelcomeSent(id, now().toISOString());
        log.info('early_access_welcome', { sent, to_hash: toHash });
      }
      const since = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
      await maybeAlertSpike(await deps.store.countSince(since), now().getTime());
    } catch (err) {
      log.error('early_access_after_signup_failed', { error: err instanceof StoreError ? err.code : 'unknown', to_hash: toHash });
    }
  };

  router.post('/', overall, perIp, async (req: Request, res: Response) => {
    const parsed = SignupBody.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, 'INVALID_REQUEST');

    try {
      const outcome = await handleSignup(parsed.data, deps.store, { now: now(), domainCheck: deps.domainCheck });
      switch (outcome.kind) {
        case 'rejected':
          log.info('early_access_rejected', { code: outcome.code });
          return fail(res, 400, outcome.code);
        case 'dropped':
          log.info('early_access_dropped', { reason: outcome.reason });
          return res.status(202).json(ACCEPTED);
        case 'repeat':
          return res.status(202).json(ACCEPTED);
        case 'welcome':
          res.status(202).json(ACCEPTED);
          log.info('early_access_signup', { resubscribed: outcome.resubscribed, to_hash: hashEmailForLog(outcome.email) });
          void afterSignup(outcome.id, outcome.email);
          return;
      }
    } catch (err) {
      const code = err instanceof StoreError ? err.code : 'unknown';
      // Name + short message only for unexpected errors (no request data in them).
      log.error('early_access_store_failed', {
        code,
        ...(err instanceof StoreError ? { reason: err.reason } : { error: err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : 'non-error' }),
      });
      void maybeAlertFailing(code, now().getTime());
      return fail(res, 503, 'UNAVAILABLE');
    }
  });

  router.get('/unsubscribe', unsubLimit, (req: Request, res: Response) => {
    const token = tokenFrom(req);
    if (!readUnsubscribeToken(token)) return sendPage(res, 400, BAD_LINK);
    const t = String(token).replace(/[^A-Za-z0-9._-]/g, '');
    sendPage(
      res,
      200,
      page(
        'Unsubscribe',
        `<h1>Unsubscribe?</h1><p>You'll stop getting emails about Authentic Materials early access.</p>
        <form method="post" action="?t=${t}"><button type="submit">Unsubscribe</button></form>`,
      ),
    );
  });

  router.post('/unsubscribe', unsubLimit, express.urlencoded({ extended: false, limit: '1kb' }), async (req: Request, res: Response) => {
    const id = readUnsubscribeToken(tokenFrom(req));
    const oneClick = (req.body as Record<string, unknown> | undefined)?.['List-Unsubscribe'] === 'One-Click';
    if (!id) return oneClick ? res.status(400).send('invalid') : sendPage(res, 400, BAD_LINK);

    try {
      const changed = await deps.store.unsubscribe(id, now().toISOString());
      log.info('early_access_unsubscribed', { changed, one_click: oneClick });
    } catch (err) {
      log.error('early_access_unsubscribe_failed', { code: err instanceof StoreError ? err.code : 'unknown' });
      return oneClick
        ? res.status(503).send('try again')
        : sendPage(res, 503, page('Try again', '<h1>Try again in a minute</h1><p>Something went wrong on our side. Your link still works.</p>'));
    }
    if (oneClick) return res.status(200).send('unsubscribed');
    sendPage(
      res,
      200,
      page("You're unsubscribed", "<h1>You're unsubscribed</h1><p>No more early-access emails. Changed your mind? Sign up again on <a href=\"https://authentic-materials.com/#access\">authentic-materials.com</a>.</p>"),
    );
  });

  return router;
};

/** Production wiring. Created lazily so importing this module never touches the network. */
let prodRouter: Router | null = null;
export const earlyAccessRoutes: Router = Router();
earlyAccessRoutes.use((req, res, next) => {
  prodRouter ??= createEarlyAccessRouter({ store: createSupabaseStore(), send: sendEmail });
  prodRouter(req, res, next);
});
