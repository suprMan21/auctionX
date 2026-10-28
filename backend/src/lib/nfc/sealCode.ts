/**
 * Seal codes (S-SEAL1, Decision Locked 2026-10-26): 8 random Crockford base32
 * characters, stored without the hyphen, shown as XXXX-XXXX. The database
 * generates them (gen_seal_code); this file only checks and formats.
 *
 * A seal code identifies a seal. It never authenticates one: only a tap does.
 */

/** Stored form: 8 characters, no I, L, O or U. */
export const SEAL_CODE_STORED = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Display form: XXXX-XXXX. */
export const SEAL_CODE_DISPLAY = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** XXXX-XXXX for a well-formed stored code; null for anything else (never a half-formed code). */
export const displaySealCode = (stored: string | null | undefined): string | null =>
  typeof stored === 'string' && SEAL_CODE_STORED.test(stored) ? `${stored.slice(0, 4)}-${stored.slice(4)}` : null;
