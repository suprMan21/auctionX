/**
 * Common throwaway-email domains. Bundled (no lookup service, no third party).
 * Deliberately short: the big public lists catch a long tail at the cost of false
 * positives. Add a domain here when one shows up in signups.
 */
export const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com', '10minutemail.net', '20minutemail.com', '33mail.com', 'anonaddy.me', 'burnermail.io',
  'byom.de', 'dispostable.com', 'dropmail.me', 'emailondeck.com', 'fakeinbox.com', 'fakemail.net',
  'getairmail.com', 'getnada.com', 'guerrillamail.biz', 'guerrillamail.com', 'guerrillamail.de',
  'guerrillamail.info', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'harakirimail.com',
  'inboxkitten.com', 'jetable.org', 'mail.tm', 'mailcatch.com', 'maildrop.cc', 'mailinator.com',
  'mailinator.net', 'mailnesia.com', 'mailpoof.com', 'mailsac.com', 'mintemail.com', 'moakt.com',
  'mohmal.com', 'mytemp.email', 'nada.email', 'sharklasers.com', 'spam4.me', 'spamgourmet.com',
  'temp-mail.io', 'temp-mail.org', 'tempail.com', 'tempmail.com', 'tempmail.dev', 'tempmail.net',
  'tempmailo.com', 'tempr.email', 'throwawaymail.com', 'tmail.ws', 'tmpmail.net', 'tmpmail.org',
  'trashmail.com', 'trashmail.de', 'trashmail.net', 'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'example.com', 'example.net', 'example.org',
]);
