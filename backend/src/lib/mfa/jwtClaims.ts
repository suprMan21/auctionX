/**
 * Reads claims from a bearer token that GoTrue has ALREADY verified.
 *
 * Safe only after `requireAuth` / `verifyAdminAuth` (both call getUser on the
 * same token first). Never call this on an unauthenticated path: the signature
 * is not checked here.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface VerifiedClaims {
  /** The Supabase session this token belongs to; null when absent or malformed. */
  sessionId: string | null;
  sub: string | null;
}

export const readVerifiedClaims = (authHeader: string | undefined): VerifiedClaims => {
  const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
  const payload = token?.split('.')[1];
  if (!payload) return { sessionId: null, sub: null };

  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      session_id?: unknown;
      sub?: unknown;
    };
    return {
      sessionId: typeof decoded.session_id === 'string' && UUID_RE.test(decoded.session_id)
        ? decoded.session_id.toLowerCase()
        : null,
      sub: typeof decoded.sub === 'string' ? decoded.sub : null,
    };
  } catch {
    return { sessionId: null, sub: null };
  }
};
