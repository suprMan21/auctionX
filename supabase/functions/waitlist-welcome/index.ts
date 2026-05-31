/**
 * waitlist-welcome Edge Function (S23.5)
 *
 * Sends a welcome email when a row is inserted into `waitlist_signups`. Wired
 * via a Supabase Database Webhook (Dashboard → Database → Webhooks) on the
 * `INSERT` event for the `waitlist_signups` table. The webhook posts a JSON
 * envelope of the form:
 *
 *   { type: 'INSERT', table: 'waitlist_signups', schema: 'public',
 *     record: { id, email, source, created_at }, old_record: null }
 *
 * Auth: `Authorization: Bearer <WAITLIST_WEBHOOK_SECRET>` header configured
 * on the webhook itself. Constant-time compare so a wrong token returns 401
 * before any body parse.
 *
 * Source-aware templates: `collector` (default), `creator`, and any `am-*`
 * variant fall back to the SFW Authentic Materials welcome.
 *
 * Idempotency: the underlying `waitlist_signups.email` UNIQUE constraint
 * prevents duplicate INSERTs from happening in the first place. If Supabase
 * retries the webhook delivery on a transient 5xx, we may double-send — that
 * is acceptable at this scale and preferable to maintaining a separate
 * delivery-log table.
 *
 * @module waitlist-welcome
 */

import { sendEmail } from '../_shared/postmark.ts';
import { logger } from '../_shared/utils/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

interface WaitlistRow {
  id: string;
  email: string;
  source: string;
  created_at: string;
}

interface WebhookEnvelope {
  type?: string;
  table?: string;
  schema?: string;
  record?: WaitlistRow;
  old_record?: unknown;
}

// Constant-time string compare (Deno doesn't ship crypto.timingSafeEqual on
// the web API surface; reach for the equivalent via TextEncoder + manual XOR).
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  if (aBuf.length !== bBuf.length) return false;
  let diff = 0;
  for (let i = 0; i < aBuf.length; i++) diff |= aBuf[i] ^ bBuf[i];
  return diff === 0;
}

function frontendUrl(): string {
  return Deno.env.get('FRONTEND_URL') ?? 'https://d1bwev65w7rqzl.cloudfront.net';
}

function renderTemplate(source: string): { subject: string; htmlBody: string } {
  const fe = frontendUrl();
  if (source === 'creator') {
    return {
      subject: "Welcome — let's get you set up to sell",
      htmlBody: wrap("You're on the creator list.", `
        <p style="color:#9ca3af;margin:0 0 16px;">Thanks for putting your name in. We're rolling out creator tools in waves — when your invite lands you'll get a follow-up with onboarding steps for listings, payouts, and identity verification.</p>
        <p style="color:#9ca3af;margin:0 0 16px;">In the meantime, the consumer side is live if you want to see how listings present to collectors.</p>
        ${btn(`${fe}/creator`, 'Become a creator')}
        <p style="color:#6b7280;margin:24px 0 0;font-size:12px;">We only email when something matters. Reply STOP to opt out.</p>
      `),
    };
  }
  // collector (default) + any am-* variant fall through here
  return {
    subject: "You're on the list — Authentic Materials",
    htmlBody: wrap("You're on the list.", `
      <p style="color:#9ca3af;margin:0 0 16px;">Thanks for signing up. We're building Authentic Materials as the marketplace where every collectible has a verifiable chain of custody — NFC-authenticated, blockchain-anchored, and tied to the creator who released it.</p>
      <p style="color:#9ca3af;margin:0 0 16px;">When new drops go live, you'll get a heads-up here. Nothing else.</p>
      ${btn(`${fe}/collector`, 'Browse the marketplace')}
      <p style="color:#6b7280;margin:24px 0 0;font-size:12px;">We only email when something matters. Reply STOP to opt out.</p>
    `),
  };
}

// Local copies of the wrap/btn helpers from backend/src/lib/notifications/
// emailTemplates.ts. Inline because Deno can't import npm/Node code.
function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family:sans-serif;background:#13131a;color:#e5e7eb;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a24;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
    <h1 style="font-size:24px;font-weight:700;margin:0 0 8px;background:linear-gradient(90deg,#7c3aed,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
      Authentic Materials
    </h1>
    <h2 style="font-size:20px;margin:24px 0 8px;color:#e5e7eb;">${title}</h2>
    ${body}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
    <p style="font-size:12px;color:#6b7280;margin:0;">authentic-materials.com</p>
  </div>
</body>
</html>`;
}

function btn(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:8px;padding:12px 24px;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px;">${text}</a>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Auth (constant-time Bearer compare against WAITLIST_WEBHOOK_SECRET).
  const expected = Deno.env.get('WAITLIST_WEBHOOK_SECRET');
  if (!expected) {
    logger.error('waitlist-welcome: WAITLIST_WEBHOOK_SECRET unset', undefined, {});
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const authHeader = req.headers.get('authorization') ?? '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
  if (!constantTimeEqual(provided, expected)) {
    logger.warn('waitlist-welcome: invalid Bearer token', {});
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 2. Parse + validate the webhook envelope.
  let envelope: WebhookEnvelope;
  try {
    envelope = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 3. Ignore non-matching events benignly (200 — we don't want Supabase to retry).
  if (envelope.type !== 'INSERT' || envelope.table !== 'waitlist_signups') {
    logger.info('waitlist-welcome: ignored non-matching event', {
      type: envelope.type,
      table: envelope.table,
    });
    return new Response(JSON.stringify({ ignored: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const row = envelope.record;
  if (!row?.email || !row.source) {
    logger.warn('waitlist-welcome: envelope missing email or source', { row });
    return new Response(JSON.stringify({ error: 'Malformed record' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // 4. Render + send. Failure is logged but returns 200 so Supabase doesn't
  // retry — Postmark handles its own bounce/suppression list.
  const { subject, htmlBody } = renderTemplate(row.source);
  const sent = await sendEmail({ to: row.email, subject, htmlBody });
  logger.info('waitlist-welcome: send result', {
    to: row.email,
    source: row.source,
    sent,
  });

  return new Response(JSON.stringify({ sent }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
