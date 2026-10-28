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
    nfc_tags: [{ id: TAG, chip_name: 'chip_004', chip_serial: 'AAAA00BBBB11CC22', seal_code: '7K3Q9XWD' }],
    users: [{ id: FROM, email: 'sender@example.com' }, { id: TO, email: 'recipient@example.com' }],
  };
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('token activity emails', () => {
  it('content: plain wording, no em dashes', async () => {
    const { tokenActivityEmailContent } = await import('../lib/notifications/tokenActivityEmails');
    for (const kind of ['token_released', 'transfer_sent', 'transfer_received'] as const) {
      const c = tokenActivityEmailContent({ kind, token: '7K3Q-9XWD', at: '2026-10-27T18:00:00Z' });
      const all = [c.subject, ...c.lines, c.cta.text].join(' ');
      expect(all).not.toMatch(/—/);
      expect(all).toContain('7K3Q-9XWD');
      expect(all).toContain('27 October 2026, 18:00 UTC');
      expect(all).toMatch(/\bseal\b/i);
      expect(all).not.toMatch(/\b(token|chip)s?\b/i);
      const unnamed = tokenActivityEmailContent({ kind, token: null, at: '2026-10-27T18:00:00Z' });
      expect(unnamed.lines.join(' ')).not.toMatch(/null|undefined|from your account was/);
    }
  });

  it('tokenLabel shows only the seal code, never the chip name or serial', async () => {
    const { tokenLabel } = await import('../lib/notifications/tokenActivityEmails');
    expect(tokenLabel({ seal_code: '7K3Q9XWD' })).toBe('7K3Q-9XWD');
    expect(tokenLabel({ seal_code: null })).toBeNull();
    expect(tokenLabel({ seal_code: 'bad' })).toBeNull();
    expect(tokenLabel(null)).toBeNull();
  });

  it('a release notice names the seal by its code', async () => {
    const { notifyReleased } = await import('../lib/notifications/tokenActivityEmails');
    await notifyReleased(createMockSupabase(tables) as never, 'owner@example.com', TAG);
    await flush();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([['owner@example.com', 'You released a seal']]);
    expect(sent[0].text).toContain('Your seal 7K3Q-9XWD was released');
    expect(sent[0].text).not.toContain('chip_004');
  });

  it('a completed transfer tells both parties, never naming the other', async () => {
    const { notifyTransferCompleted } = await import('../lib/notifications/tokenActivityEmails');
    await notifyTransferCompleted(createMockSupabase(tables) as never, 'tr1');
    await flush();
    expect(sent.map((m) => [m.to, m.subject])).toEqual([
      ['sender@example.com', 'Your seal has moved to its new owner'],
      ['recipient@example.com', 'A seal is now in your account'],
    ]);
    expect(sent[1].text).toContain('Seal 7K3Q-9XWD moved into your account');
    expect(sent.map((m) => m.text).join(' ')).not.toContain('chip_004');
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
