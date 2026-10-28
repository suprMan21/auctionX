/**
 * Security mail through Amazon SES (S-2FA Ph3b, Boss 2026-10-27).
 *
 * Why SES: Postmark keeps every message body for at least 7 days, account-wide,
 * and the server token can read them back. SES stores no message body. Codes
 * therefore go through SES ONLY: when SES is not configured, a code is not
 * sent at all (the caller answers 503). Security notices without a code
 * (method added, recovery started, …) use SES when it is configured and fall
 * back to Postmark until then.
 *
 * No configuration set is named, so SES adds no open or click tracking and no
 * event destination ever sees the body. Credentials come from the default AWS
 * chain (App Runner instance role). Never logs an address, subject or body.
 *
 * Env: SECURITY_MAIL_FROM (required to enable), SES_REGION (else AWS_REGION,
 * else us-east-2).
 */

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { sendEmail, type EmailPayload } from './emailSender';
import { log } from '../logger';

type SesSend = (input: { from: string; to: string; subject: string; html: string; text: string }) => Promise<void>;

let client: SESv2Client | null = null;

const defaultSend: SesSend = async ({ from, to, subject, html, text }) => {
  client ??= new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION || 'us-east-2' });
  await client.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
      },
    },
  }));
};

let sesSend: SesSend = defaultSend;

const fromAddress = (): string | null => {
  const v = process.env.SECURITY_MAIL_FROM?.trim();
  return v && !v.startsWith('FILL_IN') ? v : null;
};

export const isSecurityMailConfigured = (): boolean => fromAddress() !== null;

/**
 * Sends through SES. False (logged without any address or content) when SES is
 * not configured or the send failed. Never throws.
 */
export const sendViaSes = async (payload: EmailPayload & { kind: string }): Promise<boolean> => {
  const from = fromAddress();
  if (!from) {
    log.warn('security_mail_not_configured', { kind: payload.kind });
    return false;
  }
  try {
    await sesSend({ from, to: payload.to, subject: payload.subject, html: payload.html, text: payload.text ?? payload.subject });
    return true;
  } catch (err) {
    // Error name only: an SES message can echo the recipient.
    log.error('security_mail_failed', { kind: payload.kind, error: err instanceof Error ? err.name : 'unknown' });
    return false;
  }
};

/** A security notice that carries no code: SES when configured, else Postmark. */
export const sendSecurityNotice = (payload: EmailPayload & { kind: string }): Promise<boolean> =>
  isSecurityMailConfigured() ? sendViaSes(payload) : sendEmail(payload);

/** Test seam. */
export const __setSesSend = (fn: SesSend | null): void => {
  sesSend = fn ?? defaultSend;
};
