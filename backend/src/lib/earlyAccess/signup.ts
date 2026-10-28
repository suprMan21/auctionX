import { CONSENT_TEXTS, MIN_FILL_MS, SIGNUP_SOURCE } from './constants';
import { checkEmailDomain, type DomainVerdict } from './emailDomain';
import { verifyPow } from './pow';

/** What the signup needs from the database. Supabase in production, in-memory in tests. */
export interface EarlyAccessStore {
  findByEmail(email: string): Promise<{ id: string; unsubscribed_at: string | null } | null>;
  /** Returns the new id, or 'duplicate' when the email is already on the list (race-safe). */
  insert(row: { email: string; source: string; consent_text: string; consent_at: string }): Promise<{ id: string } | 'duplicate'>;
  resubscribe(id: string, consent: { consent_text: string; consent_at: string }): Promise<void>;
  markWelcomeSent(id: string, at: string): Promise<void>;
  /** True when a subscribed row was found and unsubscribed now. */
  unsubscribe(id: string, at: string): Promise<boolean>;
  countSince(iso: string): Promise<number>;
}

export interface SignupInput {
  email: string;
  consentText: string;
  /** Honeypot: a field people never see. */
  website: string;
  /** ms the form was open before submit (client clock difference, not absolute). */
  fillMs: number;
  pow: { ts: number; nonce: string };
}

export type SignupOutcome =
  /** Saved; send the welcome email to this id. */
  | { kind: 'welcome'; id: string; email: string; resubscribed: boolean }
  /** Already on the list: nothing to do, same reply. */
  | { kind: 'repeat' }
  /** Bot signals: answer like a success, store nothing. */
  | { kind: 'dropped'; reason: 'honeypot' | 'too_fast' }
  /** Tell the person (their input is the problem). */
  | { kind: 'rejected'; code: 'INVALID_CONSENT' | 'BAD_POW' | 'EMAIL_DISPOSABLE' | 'EMAIL_NO_MAIL' };

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export const handleSignup = async (
  input: SignupInput,
  store: EarlyAccessStore,
  opts: { now?: Date; domainCheck?: (email: string) => Promise<DomainVerdict> } = {},
): Promise<SignupOutcome> => {
  if (input.website.trim() !== '') return { kind: 'dropped', reason: 'honeypot' };
  if (input.fillMs < MIN_FILL_MS) return { kind: 'dropped', reason: 'too_fast' };
  if (!CONSENT_TEXTS.includes(input.consentText)) return { kind: 'rejected', code: 'INVALID_CONSENT' };

  const now = opts.now ?? new Date();
  const email = normaliseEmail(input.email);
  if (!verifyPow(email, input.pow, now.getTime())) return { kind: 'rejected', code: 'BAD_POW' };

  const domain = await (opts.domainCheck ?? checkEmailDomain)(email);
  if (domain === 'disposable') return { kind: 'rejected', code: 'EMAIL_DISPOSABLE' };
  if (domain === 'no_mail') return { kind: 'rejected', code: 'EMAIL_NO_MAIL' };

  const consent = { consent_text: input.consentText, consent_at: now.toISOString() };
  const existing = await store.findByEmail(email);
  if (existing) {
    if (!existing.unsubscribed_at) return { kind: 'repeat' };
    // They left and came back: fresh consent, one fresh welcome.
    await store.resubscribe(existing.id, consent);
    return { kind: 'welcome', id: existing.id, email, resubscribed: true };
  }

  const inserted = await store.insert({ email, source: SIGNUP_SOURCE, ...consent });
  if (inserted === 'duplicate') return { kind: 'repeat' };
  return { kind: 'welcome', id: inserted.id, email, resubscribed: false };
};
