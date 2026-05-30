/**
 * FEATURE_YOTI_ENABLED reader. Centralised so a single place defines truthiness
 * for the flag. Default OFF. We only enable Yoti calls when the literal string
 * 'true' is present (App Runner env vars are static literals — Lesson).
 *
 * When false: POST /api/v1/verification/start returns 503 + YOTI_NOT_AVAILABLE.
 * The webhook endpoint stays mounted so HMAC paths remain exercisable via tests.
 */
export const isYotiFeatureEnabled = (): boolean => {
  const raw = process.env.FEATURE_YOTI_ENABLED;
  return raw === 'true' || raw === '1';
};
