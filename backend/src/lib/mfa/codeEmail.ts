/**
 * S-2FA Ph3b: the email that carries a 6-digit code. SES only (never Postmark,
 * which keeps message bodies): see lib/notifications/securityMailSender.ts.
 * The code is in the body only, never the subject (lock-screen previews).
 * Returns whether SES accepted it; never throws, never logs the code.
 */

import { sendViaSes } from '../notifications/securityMailSender';
import { heading, para, shell } from '../notifications/transferEmails';
import type { EmailCodePurpose } from './emailCodes';

const TITLES: Record<EmailCodePurpose, { subject: string; heading: string; intro: string }> = {
  recovery_start: {
    subject: 'Your code to recover your account',
    heading: 'Recover your account',
    intro: 'Use this code to start recovering your Authentic Materials account.',
  },
  recovery_finish: {
    subject: 'Your code to finish recovering your account',
    heading: 'Finish recovering your account',
    intro: 'Use this code to finish recovering your Authentic Materials account.',
  },
  backup_email_verify: {
    subject: 'Confirm your backup email',
    heading: 'Confirm your backup email',
    intro: 'Use this code to confirm this address as the backup email for an Authentic Materials account.',
  },
};

const FOOTER = "You're receiving this because someone asked for a code for an Authentic Materials account.";

export const codeEmailContent = (purpose: EmailCodePurpose, code: string, device: string) => {
  const t = TITLES[purpose];
  const lines = [
    t.intro,
    `It works for 10 minutes, only in the browser that asked for it (${device}).`,
    'We will never ask you for this code by phone, chat or email. Do not share it.',
    "If you didn't ask for it, ignore this email. Nothing on the account changes.",
  ];
  const html = shell({
    title: t.subject,
    preheader: t.intro,
    footer: FOOTER,
    body: `
      ${heading(`${t.heading}.`)}
      ${para(lines[0])}
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:24px 0;">${code}</p>
      ${lines.slice(1).map((l, i, a) => para(l.replace(/</g, '&lt;'), i === a.length - 1)).join('')}
    `,
  });
  const text = [`${t.heading}.`, '', lines[0], '', `Your code: ${code}`, '', ...lines.slice(1)].join('\n');
  return { subject: t.subject, html, text };
};

export const sendCodeEmail = (to: string, purpose: EmailCodePurpose, code: string, device: string): Promise<boolean> =>
  sendViaSes({ to, ...codeEmailContent(purpose, code, device), kind: `code_${purpose}` });
