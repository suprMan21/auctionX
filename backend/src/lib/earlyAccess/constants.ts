/**
 * Early-access signup (S-SITE2 G3). Shared constants.
 *
 * Consent wording: the server only stores wording it knows it showed. If the homepage
 * wording changes, add the new version here (keep the old one while cached pages exist)
 * and keep frontend/src/components/home/EarlyAccessForm.tsx in step.
 */
export const CONSENT_TEXTS: readonly string[] = [
  'By joining, you agree to get emails about Authentic Materials from The Craving Company Inc. Unsubscribe anytime.',
];

/** Where a signup came from. The homepage is the only live source. */
export const SIGNUP_SOURCE = 'home';

/**
 * Proof-of-work: sha256(`${POW_PREFIX}:${email}:${ts}:${nonce}`) must start with
 * POW_BITS zero bits. 16 bits is ~65k hashes on average: well under a second in a
 * phone browser, real cost for anyone signing up thousands of addresses.
 * Keep in step with frontend/src/components/home/earlyAccess.ts.
 */
export const POW_PREFIX = 'am-early-access:v1';
export const POW_BITS = 16;
/** How far the client's timestamp may be from ours (clock skew + slow phones). */
export const POW_MAX_AGE_MS = 60 * 60 * 1000;

/** A person cannot read the form and type an email faster than this. */
export const MIN_FILL_MS = 2500;

/** Reply sent for every accepted request, new or repeat or dropped: no list membership leaks. */
export const ACCEPTED = { success: true, data: { status: 'accepted' } } as const;
