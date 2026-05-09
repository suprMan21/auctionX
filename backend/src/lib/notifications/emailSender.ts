import * as postmark from 'postmark';

/** Payload passed to sendEmail. */
export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send a transactional email via Postmark.
 * Requires POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL env vars.
 * Returns false and logs on failure rather than throwing, to keep auction flows non-fatal.
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.POSTMARK_FROM_EMAIL;

  if (!token || token.startsWith('FILL_IN')) {
    console.warn('[EMAIL] POSTMARK_SERVER_TOKEN not configured — skipping delivery', {
      to: payload.to,
      subject: payload.subject,
    });
    return false;
  }

  try {
    const client = new postmark.ServerClient(token);
    await client.sendEmail({
      From: from ?? 'noreply@authentic-materials.com',
      To: payload.to,
      Subject: payload.subject,
      HtmlBody: payload.html,
      TextBody: payload.text ?? payload.subject,
      MessageStream: 'outbound',
    });
    return true;
  } catch (err) {
    console.error('[EMAIL] Postmark delivery failed', { to: payload.to, subject: payload.subject, err });
    return false;
  }
}
