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
 * The locked lifecycle decision makes verified email + 2FA mandatory before any
 * origin claim or transfer completion. Enforcement (an AAL2 check) ships in
 * S-NFC3, but there is currently NO MFA enrollment path anywhere in the product,
 * so turning this on would make /claim and /transfer/:id/complete unreachable.
 *
 * HARD PREREQUISITE before this may default to true in production:
 *   "S-2FA — MFA enrollment + AAL2 step-up".
 */
export const isTwoFactorRequired = (): boolean => truthy(process.env.FEATURE_REQUIRE_2FA);
