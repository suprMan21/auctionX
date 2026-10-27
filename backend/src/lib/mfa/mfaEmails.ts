/**
 * S-2FA security emails. Transactional (not preference-gated): a change to how
 * an account signs in must always reach its owner. Delivery never blocks or
 * fails the request; logs carry a hashed address, never the address.
 *
 * Copy follows the Brand Voice Guide: plain words ("passkey", "authenticator
 * app", "backup codes"), no jargon, no em dashes.
 */

import { sendEmail } from '../notifications/emailSender';
import { frontendBaseUrl, heading, para, shell, btn } from '../notifications/transferEmails';
import { hashEmailForLog } from '../security/securityEvent';
import { log } from '../logger';

export type MfaEmail =
  /** `waitUntil` (ISO): the method was added with a code and cannot confirm a step-up before then. */
  | { kind: 'factor_added'; method: 'passkey' | 'totp'; nickname?: string; waitUntil?: string }
  | { kind: 'factor_removed'; method: 'passkey' | 'totp'; nickname?: string }
  | { kind: 'recovery_code_used'; left: number }
  | { kind: 'recovery_codes_new' }
  | { kind: 'break_glass_sign_in'; method: 'passkey' | 'recovery_code' }
  | { kind: 'code_entry_locked' }
  /** Ph2b: a permit for a password change or an email change was issued. */
  | { kind: 'account_change_started'; change: 'password' | 'email' };

const FOOTER = "You're receiving this because it's about how your Authentic Materials account signs in. These emails can't be turned off.";

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const methodName = (method: 'passkey' | 'totp', nickname?: string): string =>
  method === 'passkey' ? `a passkey${nickname ? ` ("${nickname}")` : ''}` : 'an authenticator app';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "28 October 2026, 14:05 UTC". Null for an unreadable time. */
export const formatUtc = (iso: string): string | null => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
};

export const mfaEmailContent = (email: MfaEmail): { subject: string; lines: string[] } => {
  switch (email.kind) {
    case 'factor_added': {
      const added = `${methodName(email.method, email.nickname)[0].toUpperCase()}${methodName(email.method, email.nickname).slice(1)} can now be used to sign in to your account.`;
      const until = email.waitUntil ? formatUtc(email.waitUntil) : null;
      return {
        subject: 'A new sign-in method was added to your account',
        lines: until
          ? [
              added,
              `Because it was confirmed with a code rather than a passkey, it can't approve releases, transfers or account changes until ${until}.`,
              "If this wasn't you, sign in and remove it now, then change your password.",
            ]
          : [added, "If this wasn't you, sign in and remove it from Security settings, then change your password."],
      };
    }
    case 'factor_removed':
      return {
        subject: 'A sign-in method was removed from your account',
        lines: [
          `${methodName(email.method, email.nickname)[0].toUpperCase()}${methodName(email.method, email.nickname).slice(1)} was removed and can no longer be used to sign in.`,
          "If this wasn't you, sign in and check Security settings, then change your password.",
        ],
      };
    case 'recovery_code_used':
      return {
        subject: 'A backup code was used to sign in',
        lines: [
          `Someone signed in to your account with one of your backup codes. You have ${email.left} left.`,
          email.left <= 3
            ? 'You are running low. Make a new set in Security settings, and add a passkey if you lost your device.'
            : 'If you lost your device, add a new passkey in Security settings.',
          "If this wasn't you, make a new set of backup codes now and change your password.",
        ],
      };
    case 'recovery_codes_new':
      return {
        subject: 'You have a new set of backup codes',
        lines: [
          'A new set of backup codes was made for your account. Your old codes no longer work.',
          "If this wasn't you, sign in and check Security settings, then change your password.",
        ],
      };
    case 'code_entry_locked':
      return {
        subject: 'Code entry on your account is paused',
        lines: [
          'Someone entered too many wrong codes while signing in to your account, so code entry is paused for a while. Your passkey still works.',
          "If this wasn't you, someone may know your password. Sign in with your passkey and change your password now.",
        ],
      };
    case 'account_change_started':
      return email.change === 'password'
        ? {
            subject: 'A password change was started on your account',
            lines: [
              'Someone confirmed it is you with a passkey or authenticator app and started changing the password on your account.',
              "If this wasn't you, sign in now, change your password and check Security settings.",
            ],
          }
        : {
            subject: 'An email change was started on your account',
            lines: [
              'Someone confirmed it is you with a passkey or authenticator app and started changing the email address on your account. The change finishes only when the link sent to the new address is opened.',
              "If this wasn't you, sign in now, change your password and check Security settings.",
            ],
          };
    case 'break_glass_sign_in':
      return {
        subject: 'The super admin account was just used',
        lines: [
          `The super admin account signed in with ${email.method === 'passkey' ? 'its security key' : 'a backup code'}.`,
          'This account is for emergencies only. If you did not expect this, act now: suspend the session from AWS and rotate the account password.',
        ],
      };
  }
};

/** Fire and forget. Never throws. */
export const sendMfaEmail = (to: string | null | undefined, email: MfaEmail): void => {
  if (!to) return;
  const { subject, lines } = mfaEmailContent(email);
  const securityUrl = `${frontendBaseUrl()}/settings/security`;
  const html = shell({
    title: subject,
    preheader: escapeHtml(lines[0]),
    footer: FOOTER,
    body: `
      ${heading(`${escapeHtml(subject)}.`)}
      ${lines.map((l, i) => para(escapeHtml(l), i === lines.length - 1)).join('')}
      ${btn(securityUrl, 'Open Security settings')}
    `,
  });
  const text = [`${subject}.`, '', ...lines, '', `Security settings: ${securityUrl}`].join('\n');

  void sendEmail({ to, subject, html, text })
    .then((ok) => {
      if (!ok) log.warn('mfa_email_not_sent', { kind: email.kind, to_hash: hashEmailForLog(to) });
    })
    .catch(() => log.warn('mfa_email_failed', { kind: email.kind, to_hash: hashEmailForLog(to) }));
};
