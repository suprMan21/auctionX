import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, type Tables } from './helpers/supabaseMock';

/**
 * S-2FA Ph3a — owner notices for release and completed transfers.
 * Proven: wording rules (no em dash, never names the other party, code-free),
 * both parties get the transfer notice, a failure never throws.
 */

const sent: Array<{ to: string; subject: string; text: string; html: string }> = [];
let sendResult: boolean | Error = true;

vi.mock('../lib/notifications/emailSender', () => ({
  sendEmail: async (m: { to: string; subject: string; text: string; html: string }) => {
    sent.push(m);
    if (sendResult instanceof Error) throw sendResult;
    return sendResult;
  },
}));

const FROM = '11111111-1111-4111-8111-111111111111';
const TO = '22222222-2222-4222-8222-222222222222';
const TAG = '33333333-3333-4333-8333-333333333333';

let tables: Tables;

beforeEach(() => {
  sent.length = 0;
  sendResult = true;
  tables = {
    ownership_transfers: [{ id: 'tr1', tag_id: TAG, from_user_id: FROM, to_user_id: TO, completed_at: '2026-10-27T18:00:00Z' }],
    nfc_tags: [{ id: TAG, chip_name: 'chip_004', chip_serial: 'AAAA00BBBB11CC22' }],
    users: [{ id: FROM, email: 'sender@example.com' }, { id: TO, email: 'recipient@example.com' }],
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('token activity emails', () => {
  it('content: plain wording, no em dashes', async () => {
    const { tokenActivityEmailContent } = await import('../lib/notifications/tokenActivityEmails');
    for (const kind of ['token_released', 'transfer_sent', 'transfer_received'] as const) {
      const c = tokenActivityEmailContent({ kind, token: 'chip_004', at: '2026-10-27T18:00:00Z' });
      const all = [c.subject, ...c.lines].join(' ');
      expect(all).not.toMatch(/—/);
      expect(all).toContain('chip_004');
      expect(all).toContain('27 October 2026, 18:00 UTC');
    }
  });

  it('tokenLabel prefers the chip name, else the serial end', async () => {
    const { tokenLabel } = await import('../lib/notifications/tokenActivityEmails');
    expect(tokenLabel({ chip_name: 'chip_004', chip_serial: 'x' })).toBe('chip_004');
    expect(tokenLabel({ chip_name: null, chip_serial: 'aaaa00bbbb11cc22' })).toBe('ending 11CC22');
  });

  it('a completed transfer tells both parties, never naming the other', async () => {
    const { notifyTransferCompleted } = await import('../lib/notifications/tokenActivityEmails');
    await notifyTransferCompleted(createMockSupabase(tables) as never, 'tr1');
    await flush();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['sender@example.com', 'Your token has moved to its new owner'],
      ['recipient@example.com', 'A token is now in your account'],
    ]);
    expect(sent[0].text).not.toContain('recipient@example.com');
    expect(sent[1].text).not.toContain('sender@example.com');
  });

  it('a missing transfer or a failed send never throws', async () => {
    const { notifyTransferCompleted, sendTokenActivityEmail } = await import('../lib/notifications/tokenActivityEmails');
    await expect(notifyTransferCompleted(createMockSupabase(tables) as never, 'nope')).resolves.toBeUndefined();
    sendResult = new Error('postmark down');
    expect(() => sendTokenActivityEmail('a@example.com', { kind: 'token_released', token: 't', at: 'bad' })).not.toThrow();
    await flush();
  });
});
