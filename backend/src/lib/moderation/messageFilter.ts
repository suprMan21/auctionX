/**
 * messageFilter — simple content filter for outbound messages.
 *
 * Blocks attempts to move payment or communication off-platform.
 * Returns { allowed: true } when the message is clean,
 * or { allowed: false, reason: string } when blocked.
 */

const OFF_PLATFORM_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Payment platforms
  { pattern: /paypal\.me|paypal\.com\/send/i,             label: 'PayPal payment link' },
  { pattern: /venmo\.com|venmo:\s*@/i,                    label: 'Venmo payment link' },
  { pattern: /cash\.app|\$cashtag/i,                      label: 'CashApp payment link' },
  { pattern: /zelle\.com|send.*zelle|zelle.*send/i,       label: 'Zelle payment link' },
  { pattern: /western\s*union|moneygram/i,                label: 'wire transfer service' },
  { pattern: /bitcoin\s*address|btc\s*wallet|eth\s*wallet/i, label: 'crypto payment address' },
  // Off-platform communication
  { pattern: /whatsapp\.com|wa\.me\//i,                   label: 'WhatsApp link' },
  { pattern: /t\.me\/|telegram\.me\//i,                   label: 'Telegram link' },
  { pattern: /discord\.gg\/|discord\.com\/invite/i,       label: 'Discord invite' },
  // Suspicious payment request phrasing
  { pattern: /pay\s+me\s+directly|pay\s+outside|avoid\s+(the\s+)?fee/i, label: 'off-platform payment request' },
];

export interface FilterResult {
  allowed: boolean;
  reason?: string;
}

export function filterMessage(body: string): FilterResult {
  for (const { pattern, label } of OFF_PLATFORM_PATTERNS) {
    if (pattern.test(body)) {
      return {
        allowed: false,
        reason: `Messages containing ${label} are not permitted. All transactions must be completed on-platform.`,
      };
    }
  }
  return { allowed: true };
}
