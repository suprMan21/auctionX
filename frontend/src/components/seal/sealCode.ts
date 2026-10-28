/** Locked seal_code format: 8 Crockford base32 characters, shown as XXXX-XXXX. */
export const SEAL_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** True for a well-formed seal code in display form. */
export const isSealCode = (value: unknown): value is string => typeof value === 'string' && SEAL_CODE.test(value);
