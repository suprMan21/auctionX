/**
 * Re-issue emails to the token owner — S-ADMIN1 Ph2.
 *
 * Transactional (they answer a request the owner made), sent to the account's
 * own address. Copy follows the Brand Voice Guide: no em dashes, no hype. The
 * admin's typed reason is internal (audit row) and never appears here.
 *
 * Payment happens on the website only, never in the phone app (Boss,
 * 2026-10-09: app store fees), so the approval email links to the web pay page.
 *
 * Delivery never blocks or fails the action that triggered it. Logs carry the
 * request id and a hashed address, never the raw email.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from './emailSender';
import { hashEmailForLog } from '../security/securityEvent';
import { shell, btn, heading, para, usd, frontendBaseUrl } from './transferEmails';

export type ReissueEmailKind = 'approved' | 'waived' | 'paid' | 'rejected' | 'fulfilled';

const FOOTER =
  "You're receiving this because a replacement seal was requested for a seal on your Authentic Materials account.";

type Message = { subject: string; html: string; text: string };

const message = (subject: string, lines: string[], cta?: { href: string; label: string }): Message => ({
  subject,
  text: [subject + '.', '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.href}`] : [])].join('\n'),
  html: shell({
    title: subject,
    preheader: lines[0],
    footer: FOOTER,
    body: `
      ${heading(`${subject}.`)}
      ${lines.map((l, i) => para(l, !cta && i === lines.length - 1)).join('')}
      ${cta ? btn(cta.href, cta.label) : ''}
    `,
  }),
});

export function reissueEmail(
  kind: ReissueEmailKind,
  opts: { requestId: string; chargedAmount: number | null },
): Message {
  const site = frontendBaseUrl();
  const fee = usd(opts.chargedAmount ?? 0);
  switch (kind) {
    case 'approved':
      return message(
        'Your replacement seal was approved',
        [
          `The replacement fee is ${fee}. Pay on the Authentic Materials website and we will prepare your new seal.`,
          'Keep the old seal on the item until the new one arrives.',
        ],
        { href: `${site}/tokens/reissue/${opts.requestId}/pay`, label: 'Pay on the website' },
      );
    case 'waived':
      return message('Your replacement seal was approved', [
        'There is no fee for this replacement. We are preparing your new seal.',
        'Keep the old seal on the item until the new one arrives.',
      ]);
    case 'paid':
      return message('Payment received for your replacement seal', [
        `We received your ${fee} payment. We are preparing your new seal.`,
        'Keep the old seal on the item until the new one arrives.',
      ]);
    case 'rejected':
      return message('Your replacement seal request was not approved', [
        'We reviewed your request and could not approve it. Nothing was charged.',
        'Your seal is unchanged.',
      ]);
    case 'fulfilled':
      return message(
        'Your replacement seal is active',
        [
          'Your ownership and story now live on the new seal. The old seal has been retired and will no longer verify.',
          'You have a new Ownership ID. You can find it in My Seals.',
        ],
        { href: `${site}/tokens`, label: 'Open My Seals' },
      );
  }
}

/**
 * Emails the requester. Never throws; returns whether Postmark accepted it.
 */
export async function notifyReissueOwner(
  supabase: SupabaseClient,
  kind: ReissueEmailKind,
  request: { id: string; requesterId: string; chargedAmount: number | null },
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', request.requesterId)
      .maybeSingle();

    const to = !error && data?.email ? String(data.email) : null;
    if (!to) {
      console.warn('[EMAIL] reissue owner has no deliverable address', { reissueRequestId: request.id, kind });
      return false;
    }

    const sent = await sendEmail({
      to,
      ...reissueEmail(kind, { requestId: request.id, chargedAmount: request.chargedAmount }),
    });
    const log = sent ? console.log : console.warn;
    log(sent ? '[EMAIL] reissue email accepted by Postmark' : '[EMAIL] reissue email not delivered', {
      reissueRequestId: request.id,
      kind,
      to_email_hash: hashEmailForLog(to),
    });
    return sent;
  } catch (err) {
    console.error('[EMAIL] reissue email failed', {
      reissueRequestId: request.id,
      kind,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
