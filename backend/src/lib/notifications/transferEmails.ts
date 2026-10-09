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

export const frontendBaseUrl = (): string => process.env.FRONTEND_URL || 'http://localhost:5173';

export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * Table layout with inline styles and bgcolor fallbacks: Gmail and Outlook
 * drop <div> margins, body backgrounds and CSS gradients, so every visual
 * that matters has a plain-colour fallback underneath it.
 */
const TRANSFER_FOOTER =
  "You're receiving this because someone entered this address for a token transfer. If you weren't expecting it, you can ignore this email. Nothing happens unless you accept.";

export function shell(opts: { title: string; preheader: string; body: string; footer?: string }): string {
  const site = frontendBaseUrl();
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${opts.title}</title>
</head>
<body style="margin:0;padding:0;background-color:#0d0d12;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0d0d12;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0d0d12" style="background-color:#0d0d12;">
  <tr><td align="center" style="padding:40px 16px 48px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">

      <tr><td bgcolor="#7c3aed" style="height:4px;line-height:4px;font-size:0;background-color:#7c3aed;background-image:linear-gradient(90deg,#7c3aed,#3b82f6);border-radius:16px 16px 0 0;">&nbsp;</td></tr>

      <tr><td bgcolor="#1a1a24" style="background-color:#1a1a24;padding:28px 40px 24px;border-left:1px solid #26262f;border-right:1px solid #26262f;">
        <p style="margin:0;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#ffffff;">Authentic Materials</p>
        <p style="margin:6px 0 0;font-family:${FONT};font-size:12px;letter-spacing:0.04em;color:#a78bfa;">Where it came from matters.</p>
      </td></tr>

      <tr><td bgcolor="#1a1a24" style="background-color:#1a1a24;padding:0 40px;border-left:1px solid #26262f;border-right:1px solid #26262f;">
        <div style="height:1px;line-height:1px;font-size:0;background-color:#2a2a35;">&nbsp;</div>
      </td></tr>

      <tr><td bgcolor="#1a1a24" style="background-color:#1a1a24;padding:32px 40px 40px;border-left:1px solid #26262f;border-right:1px solid #26262f;font-family:${FONT};color:#e5e7eb;">
        ${opts.body}
      </td></tr>

      <tr><td bgcolor="#15151d" style="background-color:#15151d;padding:24px 40px 28px;border:1px solid #26262f;border-radius:0 0 16px 16px;font-family:${FONT};">
        <p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#9ca3af;">${opts.footer ?? TRANSFER_FOOTER}</p>
        <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7280;">
          <a href="${site}" style="color:#a78bfa;text-decoration:none;">authentic-materials.com</a>
          &nbsp;·&nbsp; This mailbox isn't monitored, so please don't reply.
        </p>
      </td></tr>

      <tr><td align="center" style="padding:20px 16px 0;font-family:${FONT};font-size:11px;line-height:1.6;color:#4b5563;">
        © ${year} The Craving Company Inc.
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function btn(href: string, text: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;">
  <tr><td bgcolor="#7c3aed" style="border-radius:12px;background-color:#7c3aed;background-image:linear-gradient(90deg,#7c3aed,#3b82f6);">
    <a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${text}</a>
  </td></tr>
</table>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:700;color:#ffffff;">${text}</h1>`;
}

export function para(text: string, last = false): string {
  return `<p style="margin:0 0 ${last ? 0 : 24}px;font-size:15px;line-height:1.6;color:#9ca3af;">${text}</p>`;
}

/** Numbered steps as table rows: <ol> spacing varies wildly across clients. */
function steps(items: string[]): string {
  const rows = items
    .map(
      (item, i) => `<tr>
    <td valign="top" width="36" style="padding:0 0 16px;">
      <div style="width:26px;height:26px;line-height:26px;border-radius:13px;background-color:#2a2140;color:#c4b5fd;font-size:13px;font-weight:700;text-align:center;">${i + 1}</div>
    </td>
    <td valign="top" style="padding:3px 0 16px;font-size:15px;line-height:1.6;color:#d1d5db;">${item}</td>
  </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
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
  const stepList = [
    `Sign in to Authentic Materials with this email address, or create an account with it.`,
    `Open My Tokens. The transfer is waiting there.`,
    `Have the item in hand and tap its seal with your phone. The transfer fee is ${fee}, paid when you accept.`,
  ];
  const text = [
    subject + '.',
    '',
    'Ownership moves to you once you accept. Here is how.',
    '',
    ...stepList.map((s, i) => `${i + 1}. ${s}`),
    '',
    `My Tokens: ${opts.tokensUrl}`,
    '',
    "If you weren't expecting this, you can ignore it. Nothing happens unless you accept.",
  ].join('\n');

  return {
    subject,
    text,
    html: shell({
      title: subject,
      preheader: `Ownership moves to you once you accept. Tap the seal to finish.`,
      body: `
        ${heading(`${subject}.`)}
        ${para("Ownership moves to you once you accept. Here's how.")}
        ${steps(stepList)}
        ${btn(opts.tokensUrl, 'Open My Tokens')}
      `,
    }),
  };
}

/** Sent when the owner cancels a transfer that was waiting on this address. */
export function transferCancelledEmail(): { subject: string; html: string; text: string } {
  const subject = 'A token transfer to you was cancelled';
  const line = 'The owner cancelled this transfer before it was accepted. Nothing was charged, and there is nothing you need to do.';
  return {
    subject,
    text: `${subject}.\n\n${line}`,
    html: shell({
      title: subject,
      preheader: 'Nothing was charged, and there is nothing you need to do.',
      body: `
        ${heading(`${subject}.`)}
        ${para(line, true)}
      `,
    }),
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
