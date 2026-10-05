/**
 * Transfer recipient emails (S-NFC3-FE follow-up).
 *
 * Transactional, not preference-gated: the recipient may have no account yet,
 * so there is no notification_preferences row to consult. Copy follows the
 * Brand Voice Guide (no em dashes, no hype) and never names the sender. The
 * owner's identity is theirs to share, not ours.
 *
 * Delivery never blocks or fails a transfer. Every path here resolves, and
 * logs carry the transfer id plus a hashed address, never the raw email.
 *
 * @module transferEmails
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './emailSender';
import { hashEmailForLog } from '../security/securityEvent';

export type TransferEmailKind = 'initiated' | 'cancelled';

export interface TransferRecipient {
  transferId: string;
  transferType: 'GIFT' | 'SALE';
  toUserId: string | null;
  toEmail: string | null;
  feeCents: number;
}

const frontendBaseUrl = (): string => process.env.FRONTEND_URL || 'http://localhost:5173';

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title}</title></head>
<body style="font-family:sans-serif;background:#13131a;color:#e5e7eb;margin:0;padding:0;">
  <div style="max-width:600px;margin:40px auto;background:#1a1a24;border-radius:16px;padding:32px;border:1px solid rgba(255,255,255,0.1);">
    <p style="font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#a78bfa;margin:0;">Authentic Materials</p>
    ${body}
    <hr style="border:none;border-top:1px solid rgba(255,255,255,0.1);margin:24px 0;">
    <p style="font-size:12px;color:#6b7280;margin:0;">You're receiving this because someone entered this address for a token transfer on Authentic Materials. If you weren't expecting it, you can ignore this email. Nothing happens unless you accept.</p>
  </div>
</body>
</html>`;
}

function btn(href: string, text: string): string {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;padding:12px 24px;background:linear-gradient(90deg,#7c3aed,#3b82f6);color:#fff;text-decoration:none;border-radius:12px;font-weight:600;font-size:14px;">${text}</a>`;
}

/** Sent when an owner starts a transfer to this address. */
export function transferInitiatedEmail(opts: {
  transferType: 'GIFT' | 'SALE';
  feeCents: number;
  tokensUrl: string;
}): { subject: string; html: string; text: string } {
  const gift = opts.transferType === 'GIFT';
  const subject = gift ? 'A token is being gifted to you' : 'A token is being transferred to you';
  const fee = usd(opts.feeCents);
  const steps = [
    `Sign in to Authentic Materials with this email address, or create an account with it.`,
    `Open My Tokens. The transfer is waiting there.`,
    `Have the item in hand and tap its seal with your phone. The transfer fee is ${fee}, paid when you accept.`,
  ];
  const text = [
    subject + '.',
    '',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `My Tokens: ${opts.tokensUrl}`,
    '',
    "If you weren't expecting this, you can ignore it. Nothing happens unless you accept.",
  ].join('\n');

  return {
    subject,
    text,
    html: shell(subject, `
      <h1 style="font-size:22px;margin:16px 0 8px;color:#fff;">${subject}.</h1>
      <p style="color:#9ca3af;margin:0 0 16px;">Ownership moves to you once you accept. Here's how.</p>
      <ol style="color:#d1d5db;padding-left:20px;margin:0;line-height:1.6;">
        ${steps.map((s) => `<li style="margin-bottom:8px;">${s}</li>`).join('')}
      </ol>
      ${btn(opts.tokensUrl, 'Open My Tokens')}
    `),
  };
}

/** Sent when the owner cancels a transfer that was waiting on this address. */
export function transferCancelledEmail(): { subject: string; html: string; text: string } {
  const subject = 'A token transfer to you was cancelled';
  const line = 'The owner cancelled this transfer before it was accepted. Nothing was charged, and there is nothing you need to do.';
  return {
    subject,
    text: `${subject}.\n\n${line}`,
    html: shell(subject, `
      <h1 style="font-size:22px;margin:16px 0 8px;color:#fff;">${subject}.</h1>
      <p style="color:#9ca3af;margin:0;">${line}</p>
    `),
  };
}

/**
 * Resolves where to send: the typed address, else the account's email.
 * Returns null when there is no deliverable address.
 */
async function resolveRecipientEmail(
  supabase: SupabaseClient,
  recipient: TransferRecipient,
): Promise<string | null> {
  if (recipient.toEmail) return recipient.toEmail;
  if (!recipient.toUserId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('email')
    .eq('id', recipient.toUserId)
    .maybeSingle();

  if (error || !data?.email) return null;
  return String(data.email);
}

/**
 * Emails the transfer recipient. Never throws and never blocks the caller's
 * outcome: returns whether Postmark accepted the message.
 */
export async function notifyTransferRecipient(
  supabase: SupabaseClient,
  kind: TransferEmailKind,
  recipient: TransferRecipient,
): Promise<boolean> {
  try {
    const to = await resolveRecipientEmail(supabase, recipient);
    if (!to) {
      console.warn('[EMAIL] transfer recipient has no deliverable address', {
        transferId: recipient.transferId,
        kind,
      });
      return false;
    }

    const message =
      kind === 'initiated'
        ? transferInitiatedEmail({
            transferType: recipient.transferType,
            feeCents: recipient.feeCents,
            tokensUrl: `${frontendBaseUrl()}/tokens`,
          })
        : transferCancelledEmail();

    const sent = await sendEmail({ to, ...message });
    if (sent) {
      // Success must be visible too, or a quiet log cannot tell "sent" from
      // "this code never ran".
      console.log('[EMAIL] transfer recipient email accepted by Postmark', {
        transferId: recipient.transferId,
        kind,
        to_email_hash: hashEmailForLog(to),
      });
    } else {
      console.warn('[EMAIL] transfer recipient email not delivered', {
        transferId: recipient.transferId,
        kind,
        to_email_hash: hashEmailForLog(to),
      });
    }
    return sent;
  } catch (err) {
    console.error('[EMAIL] transfer recipient email failed', {
      transferId: recipient.transferId,
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
