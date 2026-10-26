/**
 * Supabase sign-in errors as plain words. Supabase's own text ("User is
 * banned", "Invalid login credentials") is never shown as it stands.
 * Matched on the error code first, then the message (older GoTrue versions
 * send no code).
 */

export const SIGN_IN_MESSAGES = {
  banned:
    'This account cannot sign in right now. Contact hello@authentic-materials.com if you think this is a mistake.',
  invalidCredentials: 'That email and password do not match.',
  emailNotConfirmed: 'Confirm your email first. Check your inbox for the link.',
  other: 'We could not sign you in. Try again.',
} as const;

export const signInErrorMessage = (error: unknown): string => {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const c = typeof code === 'string' ? code : '';
  const m = typeof message === 'string' ? message.toLowerCase() : '';

  if (c === 'user_banned' || m.includes('user is banned')) return SIGN_IN_MESSAGES.banned;
  if (c === 'invalid_credentials' || m.includes('invalid login credentials')) return SIGN_IN_MESSAGES.invalidCredentials;
  if (c === 'email_not_confirmed' || m.includes('email not confirmed')) return SIGN_IN_MESSAGES.emailNotConfirmed;
  return SIGN_IN_MESSAGES.other;
};
