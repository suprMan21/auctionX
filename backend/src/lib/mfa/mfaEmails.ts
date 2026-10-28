/**
 * S-2FA security emails. Transactional (not preference-gated): a change to how
 * an account signs in must always reach its owner. Delivery never blocks or
 * fails the request; logs carry a hashed address, never the address.
 *
 * Copy follows the Brand Voice Guide: plain words ("passkey", "authenticator
 * app", "backup codes"), no jargon, no em dashes.
 */

import { sendSecurityNotice } from '../notifications/securityMailSender';
import { frontendBaseUrl, heading, para, shell, btn } from '../notifications/transferEmails';
import { hashEmailForLog } from '../security/securityEvent';
import { log } from '../logger';

export type MfaEmail =
  /** `waitUntil` (ISO): the method was added with a code and cannot confirm a step-up before then. */
  /** `first`: the account's first sign-in method (S-2FA Ph4: trusted on sight, so the owner must hear about it). */
  | { kind: 'factor_added'; method: 'passkey' | 'totp'; nickname?: string; waitUntil?: string; first?: boolean }
  | { kind: 'factor_removed'; method: 'passkey' | 'totp'; nickname?: string }
  | { kind: 'recovery_code_used'; left: number }
  | { kind: 'recovery_codes_new' }
  | { kind: 'break_glass_sign_in'; method: 'passkey' | 'recovery_code' }
  | { kind: 'code_entry_locked' }
  /** Ph2b: a permit for a password change or an email change was issued. */
  | { kind: 'account_change_started'; change: 'password' | 'email' }
  /** Ph3b: email-code recovery. Sent to the account email and the backup email. */
  | { kind: 'recovery_started'; holdEndsAt: string; device: string }
  | { kind: 'recovery_cancelled' }
  | { kind: 'recovery_finished'; freezeEndsAt: string }
  | { kind: 'recovery_undone' }
  | { kind: 'backup_email_added' }
  | { kind: 'backup_email_removed' };

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
      if (email.first) {
        // The owner has no method of their own yet, so "sign in and remove it" would not work.
        return {
          subject: 'A new sign-in method was added to your account',
          lines: [
            added,
            'This is the first sign-in method on your account, so your account now asks for it after your password.',
            "If this wasn't you, someone knows your password. Choose \"Recover by email\" on the sign-in page to get back in (it takes 72 hours), then change your password.",
          ],
        };
      }
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
    case 'recovery_started':
      return {
        subject: 'Someone started recovering your account',
        lines: [
          `Someone proved they can read this inbox and asked to get into your account without your passkey or authenticator app. The request came from ${email.device}.`,
          `Nothing changes yet. From ${formatUtc(email.holdEndsAt) ?? 'in 3 days'} they can finish and add their own sign-in method.`,
          "If this wasn't you, sign in with your passkey or authenticator app and cancel it in Security settings, then change your password and the password of this inbox.",
        ],
      };
    case 'recovery_cancelled':
      return {
        subject: 'Account recovery was cancelled',
        lines: [
          'The account recovery that was waiting has been cancelled. Nothing on your account changed.',
          "If you didn't cancel it, sign in and check Security settings.",
        ],
      };
    case 'recovery_finished':
      return {
        subject: 'Your account was recovered',
        lines: [
          'Your account was recovered with a code sent by email. Your old backup codes no longer work.',
          `Until ${formatUtc(email.freezeEndsAt) ?? 'a week from now'}, transfers, releases and sign-in changes are paused to keep your tokens safe.`,
          "If this wasn't you, sign in with your old passkey or authenticator app and choose Undo recovery in Security settings.",
        ],
      };
    case 'recovery_undone':
      return {
        subject: 'Account recovery was undone',
        lines: [
          'The recent account recovery was undone. The sign-in method it added was removed and its sessions were signed out.',
          'You have a new set of backup codes. Change your password and the password of your email inbox.',
        ],
      };
    case 'backup_email_added':
      return {
        subject: 'A backup email was added to your account',
        lines: [
          'A backup email address can now be used to recover your account.',
          "If this wasn't you, sign in, remove it in Security settings and change your password.",
        ],
      };
    case 'backup_email_removed':
      return {
        subject: 'A backup email was removed from your account',
        lines: [
          'This address can no longer be used to recover the account.',
          "If this wasn't you, sign in and check Security settings, then change your password.",
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

  void sendSecurityNotice({ to, subject, html, text, kind: email.kind })
    .then((ok) => {
      if (!ok) log.warn('mfa_email_not_sent', { kind: email.kind, to_hash: hashEmailForLog(to) });
    })
    .catch(() => log.warn('mfa_email_failed', { kind: email.kind, to_hash: hashEmailForLog(to) }));
};
