/**
 * Centralised feature-flag readers.
 *
 * Truthiness is defined in exactly one place per flag. App Runner env vars are
 * static literals with no `op://` resolution, so we only accept the literal
 * strings 'true' / '1' (Lesson: App Runner env vars are static literals).
 *
 * Mirrors the shape of lib/yoti/featureFlag.ts.
 */

const truthy = (raw: string | undefined): boolean => raw === 'true' || raw === '1';

/**
 * FEATURE_MARKETPLACE — S-ISO1. Default OFF.
 *
 * The auction marketplace and the Unmentionables stream are PARKED per the
 * 2026-09-18 token-first pivot (Decisions DB, Locked): the code stays deployed
 * but dormant, nothing is deleted, and re-activation requires a new Decisions DB
 * entry.
 *
 * When false, parked routers are never mounted, so every marketplace endpoint
 * 404s via the catch-all. Flipping this to 'true' plus running the re-enable SQL
 * in docs/PARKED_MARKETPLACE.md restores marketplace behaviour in full.
 */
export const isMarketplaceEnabled = (): boolean => truthy(process.env.FEATURE_MARKETPLACE);

/**
 * FEATURE_REQUIRE_2FA — S-NFC3. Default OFF.
 *
 * The locked lifecycle decision makes 2FA mandatory for every account. When on,
 * claim, transfer completion and the other token actions refuse a session that
 * has not passed its second factor (S-2FA marker, not Supabase `aal2`).
 *
 * Turn on only with the S-2FA Ph2 enrolment screens live (Ph4), or every token
 * action becomes unreachable.
 */
export const isTwoFactorRequired = (): boolean => truthy(process.env.FEATURE_REQUIRE_2FA);

/**
 * S-ADMIN2 AC 5 — admin routes require a verified second factor for this
 * session (S-2FA's own marker, not Supabase `aal2`). DEFAULT OFF until every
 * admin has enrolled a passkey (S-2FA Ph4).
 */
export const isAdminTwoFactorRequired = (): boolean => truthy(process.env.FEATURE_REQUIRE_ADMIN_2FA);

/**
 * S-2FA — release, transfer completion and price changes need a fresh,
 * single-use passkey check (`X-Step-Up`). DEFAULT OFF until the Ph2 screens
 * send it. Removing a sign-in method always needs one, flag or not.
 */
export const isStepUpRequired = (): boolean => truthy(process.env.FEATURE_REQUIRE_STEP_UP);
