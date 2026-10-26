import { describe, expect, it } from 'vitest';
import { SIGN_IN_MESSAGES, signInErrorMessage } from './signInError';

describe('signInErrorMessage', () => {
  it('maps a banned account by code or by message', () => {
    expect(signInErrorMessage({ code: 'user_banned', message: 'whatever' })).toBe(SIGN_IN_MESSAGES.banned);
    expect(signInErrorMessage({ message: 'User is banned' })).toBe(SIGN_IN_MESSAGES.banned);
    expect(SIGN_IN_MESSAGES.banned).toBe(
      'This account cannot sign in right now. Contact hello@authentic-materials.com if you think this is a mistake.',
    );
  });

  it('maps wrong email or password', () => {
    expect(signInErrorMessage({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      'That email and password do not match.',
    );
    expect(signInErrorMessage({ message: 'Invalid login credentials' })).toBe(SIGN_IN_MESSAGES.invalidCredentials);
  });

  it('maps an unconfirmed email', () => {
    expect(signInErrorMessage({ code: 'email_not_confirmed' })).toBe(
      'Confirm your email first. Check your inbox for the link.',
    );
    expect(signInErrorMessage({ message: 'Email not confirmed' })).toBe(SIGN_IN_MESSAGES.emailNotConfirmed);
  });

  it('never shows anything else as it stands', () => {
    expect(signInErrorMessage({ code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toBe(
      'We could not sign you in. Try again.',
    );
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toBe(SIGN_IN_MESSAGES.other);
    expect(signInErrorMessage(null)).toBe(SIGN_IN_MESSAGES.other);
  });
});
