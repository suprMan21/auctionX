/**
 * emailSender — stub email delivery layer (Resend-ready).
 *
 * Currently logs intent only. To integrate Resend:
 *   1. `npm install resend` in backend/
 *   2. Set RESEND_API_KEY in backend/.env
 *   3. Replace the stub body below with:
 *      ```
 *      import { Resend } from 'resend';
 *      const resend = new Resend(process.env.RESEND_API_KEY);
 *      await resend.emails.send({ from: 'noreply@auctionx.com', to, subject, html });
 *      return true;
 *      ```
 *
 * @module emailSender
 */

/** Payload passed to sendEmail. */
export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

/**
 * Send an email to a recipient.
 * Currently a stub that logs intent and returns true.
 * Replace the body with a real Resend call when API key is available.
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  console.log('[EMAIL STUB] Would send email:', {
    to: payload.to,
    subject: payload.subject,
    htmlLength: payload.html.length,
  });
  // TODO(module-16): Replace stub with Resend delivery when RESEND_API_KEY is configured.
  return true;
}
