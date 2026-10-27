/**
 * S-2FA Ph3a — owner notices for the two actions that move a token out of an
 * account for good: release, and a completed transfer (S-2FA Ph2 review: the
 * authenticator-code release path had no email tripwire).
 *
 * Transactional (not preference-gated) and fire and forget: delivery never
 * blocks or fails the action, nothing here throws, and logs carry a hashed
 * address, never the address. A transfer notice never names the other party.
 * Copy follows the Brand Voice Guide (plain words, no em dashes).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './emailSender';
import { btn, frontendBaseUrl, heading, para, shell } from './transferEmails';
import { formatUtc } from '../mfa/mfaEmails';
import { hashEmailForLog } from '../security/securityEvent';
import { log } from '../logger';

export type TokenActivityEmail =
  | { kind: 'token_released'; token: string; at: string }
  | { kind: 'transfer_sent'; token: string; at: string }
  | { kind: 'transfer_received'; token: string; at: string };

const FOOTER = "You're receiving this because it's about a token in your Authentic Materials account. These emails can't be turned off.";

const IF_NOT_YOU = "If this wasn't you, sign in now, change your password and check Security settings.";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** How a token is named in an email: its chip name, else the end of its serial. */
export const tokenLabel = (tag: { chip_name?: string | null; chip_serial?: string | null } | null): string => {
  if (tag?.chip_name) return tag.chip_name;
  if (tag?.chip_serial) return `ending ${tag.chip_serial.slice(-6).toUpperCase()}`;
  return 'from your account';
};

export const tokenActivityEmailContent = (email: TokenActivityEmail): { subject: string; lines: string[]; cta: { path: string; text: string } } => {
  const when = formatUtc(email.at) ?? 'just now';
  switch (email.kind) {
    case 'token_released':
      return {
        subject: 'You released a token',
        lines: [
          `Your token ${email.token} was released from your account on ${when}. A release can't be undone.`,
          IF_NOT_YOU,
        ],
        cta: { path: '/settings/security', text: 'Open Security settings' },
      };
    case 'transfer_sent':
      return {
        subject: 'Your token has moved to its new owner',
        lines: [
          `The transfer of your token ${email.token} finished on ${when}. It is no longer in your account.`,
          "If you didn't start this transfer, sign in now, change your password and check Security settings.",
        ],
        cta: { path: '/settings/security', text: 'Open Security settings' },
      };
    case 'transfer_received':
      return {
        subject: 'A token is now in your account',
        lines: [
          `The transfer of token ${email.token} to your account finished on ${when}. You can see it in My Tokens.`,
          "If you didn't accept this transfer, sign in now, change your password and check Security settings.",
        ],
        cta: { path: '/tokens', text: 'Open My Tokens' },
      };
  }
};

/** Fire and forget. Never throws. */
export const sendTokenActivityEmail = (to: string | null | undefined, email: TokenActivityEmail): void => {
  if (!to) return;
  try {
    const { subject, lines, cta } = tokenActivityEmailContent(email);
    const url = `${frontendBaseUrl()}${cta.path}`;
    const html = shell({
      title: subject,
      preheader: escapeHtml(lines[0]),
      footer: FOOTER,
      body: `
        ${heading(`${escapeHtml(subject)}.`)}
        ${lines.map((l, i) => para(escapeHtml(l), i === lines.length - 1)).join('')}
        ${btn(url, cta.text)}
      `,
    });
    const text = [`${subject}.`, '', ...lines, '', `${cta.text}: ${url}`].join('\n');
    void sendEmail({ to, subject, html, text })
      .then((sent) => {
        if (!sent) log.warn('token_activity_email_not_sent', { kind: email.kind, to_hash: hashEmailForLog(to) });
      })
      .catch(() => log.warn('token_activity_email_failed', { kind: email.kind, to_hash: hashEmailForLog(to) }));
  } catch {
    log.warn('token_activity_email_failed', { kind: email.kind, to_hash: hashEmailForLog(to) });
  }
};

/**
 * After a transfer completes (card webhook, voucher, sweep or Re-apply): tells
 * the previous owner the token left and the new owner it arrived. Looks the
 * parties up itself so every completion path makes one call. Never throws.
 */
export const notifyTransferCompleted = async (supabase: SupabaseClient, transferId: string): Promise<void> => {
  try {
    const { data: transfer } = await supabase
      .from('ownership_transfers')
      .select('id, tag_id, from_user_id, to_user_id, completed_at')
      .eq('id', transferId)
      .maybeSingle();
    if (!transfer) return;
    const t = transfer as { tag_id: string | null; from_user_id: string | null; to_user_id: string | null; completed_at?: string | null };

    const ids = [t.from_user_id, t.to_user_id].filter((id): id is string => !!id);
    const [{ data: tag }, { data: users }] = await Promise.all([
      t.tag_id
        ? supabase.from('nfc_tags').select('chip_name, chip_serial').eq('id', t.tag_id).maybeSingle()
        : Promise.resolve({ data: null }),
      ids.length > 0 ? supabase.from('users').select('id, email').in('id', ids) : Promise.resolve({ data: [] }),
    ]);
    const emails = new Map(((users ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]));
    const token = tokenLabel(tag as { chip_name?: string | null; chip_serial?: string | null } | null);
    const at = t.completed_at ?? new Date().toISOString();

    if (t.from_user_id) sendTokenActivityEmail(emails.get(t.from_user_id), { kind: 'transfer_sent', token, at });
    if (t.to_user_id && t.to_user_id !== t.from_user_id) {
      sendTokenActivityEmail(emails.get(t.to_user_id), { kind: 'transfer_received', token, at });
    }
  } catch {
    log.warn('transfer_completed_notice_failed', { transferId });
  }
};
