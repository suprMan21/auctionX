import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { randomBytes } from 'crypto';
import {
  buildPreimage,
  computeOwnershipId,
  mintOwnershipProof,
  openReceipt,
  localSaltEnvelopeProvider,
  tagRefFor,
  OWNERSHIP_SALT_BYTES,
  type SecurityLogContext,
} from '../lib/ownership/ownershipProof';

/**
 * S-NFC3 — Ownership ID and Receipt.
 *
 * Acceptance criteria covered here:
 *   - "Receipt preimage recomputes to the stored Ownership ID (test with an
 *      independent keccak256 implementation)"
 *   - salt is 32 bytes, enveloped, and recoverable
 *   - the preimage contains no account id or personal data
 */

// ───────────────────────────────────────────────────────────────────────────
// Independent keccak256.
//
// Implemented from the Keccak specification directly, sharing NO code with
// `viem` (which is what the production path uses). If both agree on a digest,
// the production implementation is doing real keccak256 and not, say,
// NIST SHA3-256 — which is a DIFFERENT function with the same output length
// and would silently produce wrong, unverifiable Ownership IDs forever.
// ───────────────────────────────────────────────────────────────────────────

const MASK = (1n << 64n) - 1n;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

const ROTC = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PILN = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];

const rotl = (x: bigint, n: number): bigint =>
  ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

const keccakF = (a: bigint[]): void => {
  const bc = new Array<bigint>(5).fill(0n);

  for (let round = 0; round < 24; round++) {
    // Theta
    for (let i = 0; i < 5; i++) bc[i] = a[i] ^ a[i + 5] ^ a[i + 10] ^ a[i + 15] ^ a[i + 20];
    for (let i = 0; i < 5; i++) {
      const t = bc[(i + 4) % 5] ^ rotl(bc[(i + 1) % 5], 1);
      for (let j = 0; j < 25; j += 5) a[j + i] = (a[j + i] ^ t) & MASK;
    }

    // Rho + Pi
    let t = a[1];
    for (let i = 0; i < 24; i++) {
      const j = PILN[i];
      const tmp = a[j];
      a[j] = rotl(t, ROTC[i]);
      t = tmp;
    }

    // Chi
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) bc[i] = a[j + i];
      for (let i = 0; i < 5; i++) {
        a[j + i] = (a[j + i] ^ ((bc[(i + 1) % 5] ^ MASK) & bc[(i + 2) % 5])) & MASK;
      }
    }

    // Iota
    a[0] = (a[0] ^ RC[round]) & MASK;
  }
};

/** Keccak-256 (Ethereum flavour: 0x01 domain padding, NOT SHA3's 0x06). */
const independentKeccak256 = (input: Buffer): string => {
  const RATE = 136;
  const state = new Array<bigint>(25).fill(0n);

  const padded = Buffer.alloc(Math.ceil((input.length + 1) / RATE) * RATE);
  input.copy(padded);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  for (let offset = 0; offset < padded.length; offset += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      state[i] ^= padded.readBigUInt64LE(offset + i * 8);
      state[i] &= MASK;
    }
    keccakF(state);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(state[i], i * 8);
  return `0x${out.toString('hex')}`;
};

describe('independent keccak256 (test harness sanity)', () => {
  it('matches the known keccak256 of the empty string', () => {
    // The canonical Ethereum value. If this line fails, the harness is wrong,
    // not the production code.
    expect(independentKeccak256(Buffer.alloc(0))).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });

  it('matches the known keccak256 of "abc"', () => {
    expect(independentKeccak256(Buffer.from('abc', 'utf8'))).toBe(
      '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────

const ctx: SecurityLogContext = {
  requestId: 'test-request',
  actorId: '11111111-1111-4111-8111-111111111111',
  actorType: 'user',
  ip: '203.0.113.7',
  route: '/api/v1/nfc/claim',
};

const TAG_ID = '22222222-2222-4222-8222-222222222222';
const EVENT_ID = '33333333-3333-4333-8333-333333333333';

describe('ownership proof', () => {
  let logSpy: MockInstance<(...args: unknown[]) => void>;

  beforeEach(() => {
    process.env.OWNERSHIP_SALT_KEY = randomBytes(32).toString('base64');
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}) as unknown as MockInstance<(...args: unknown[]) => void>;
  });

  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.OWNERSHIP_SALT_KEY;
  });

  it('computes an Ownership ID that an independent keccak256 reproduces', () => {
    const salt = randomBytes(OWNERSHIP_SALT_BYTES);
    const tagRef = tagRefFor(TAG_ID);

    const produced = computeOwnershipId(tagRef, EVENT_ID, salt);
    const independent = independentKeccak256(buildPreimage(tagRef, EVENT_ID, salt));

    expect(produced).toBe(independent);
    expect(produced).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('encodes the event id as 16 raw bytes, not 36 characters of text', () => {
    const salt = Buffer.alloc(OWNERSHIP_SALT_BYTES, 7);
    const tagRef = 'am:tag:x';
    const preimage = buildPreimage(tagRef, EVENT_ID, salt);

    // utf8(tagRef) + 16 + 32. Text encoding would make this 36 bytes longer.
    expect(preimage.length).toBe(Buffer.byteLength(tagRef) + 16 + OWNERSHIP_SALT_BYTES);
  });

  it('rejects a malformed event id and a wrong-length salt', () => {
    expect(() => buildPreimage('am:tag:x', 'not-a-uuid', Buffer.alloc(32))).toThrow();
    expect(() => buildPreimage('am:tag:x', EVENT_ID, Buffer.alloc(16))).toThrow();
  });

  it('never puts an account id or the chip UID in the preimage', () => {
    const salt = randomBytes(OWNERSHIP_SALT_BYTES);
    const preimage = buildPreimage(tagRefFor(TAG_ID), EVENT_ID, salt).toString('utf8');

    expect(preimage).not.toContain(ctx.actorId as string);
    // tag_ref is the internal row id, never the chip UID.
    expect(tagRefFor(TAG_ID)).toBe(`am:tag:${TAG_ID}`);
  });

  it('produces a different Ownership ID for the same tag and event on each mint', () => {
    const a = mintOwnershipProof(
      { tagId: TAG_ID, ownershipEventId: EVENT_ID, ownershipEventType: 'claim' },
      ctx,
    );
    const b = mintOwnershipProof(
      { tagId: TAG_ID, ownershipEventId: EVENT_ID, ownershipEventType: 'claim' },
      ctx,
    );

    // The salt is what makes an Ownership ID unguessable from public data.
    expect(a.ownershipId).not.toBe(b.ownershipId);
  });

  it('round-trips the salt through the envelope and recomputes the same ID', () => {
    const minted = mintOwnershipProof(
      { tagId: TAG_ID, ownershipEventId: EVENT_ID, ownershipEventType: 'claim' },
      ctx,
    );

    const receipt = openReceipt({ tagId: TAG_ID, saltEnc: minted.saltEnc }, ctx);
    const salt = Buffer.from(receipt.saltHex, 'hex');

    expect(salt.length).toBe(OWNERSHIP_SALT_BYTES);
    // Revealing the Receipt proves the holder held that ownership.
    expect(computeOwnershipId(receipt.tagRef, EVENT_ID, salt)).toBe(minted.ownershipId);
  });

  it('never stores the plaintext salt in the envelope', () => {
    const salt = randomBytes(OWNERSHIP_SALT_BYTES);
    const envelope = localSaltEnvelopeProvider.encrypt(salt);

    expect(envelope).not.toContain(salt.toString('hex'));
    expect(envelope).not.toContain(salt.toString('base64'));
    expect(localSaltEnvelopeProvider.decrypt(envelope).equals(salt)).toBe(true);
  });

  it('rejects a tampered envelope rather than returning wrong bytes', () => {
    const envelope = localSaltEnvelopeProvider.encrypt(randomBytes(OWNERSHIP_SALT_BYTES));
    const [v, iv, tag, ct] = envelope.split('.');
    const flipped = Buffer.from(ct, 'base64');
    flipped[0] ^= 0xff;

    // AES-GCM auth tag must catch this.
    expect(() =>
      localSaltEnvelopeProvider.decrypt([v, iv, tag, flipped.toString('base64')].join('.')),
    ).toThrow();
  });

  it('emits a kms.op event for each envelope operation', () => {
    const minted = mintOwnershipProof(
      { tagId: TAG_ID, ownershipEventId: EVENT_ID, ownershipEventType: 'claim' },
      ctx,
    );
    openReceipt({ tagId: TAG_ID, saltEnc: minted.saltEnc }, ctx);

    const events = logSpy.mock.calls
      .map((args: unknown[]) => JSON.parse(String(args[0])) as Record<string, unknown>)
      .filter((e) => e.event === 'kms.op');

    expect(events.map((e) => e.operation)).toEqual(['Encrypt', 'Decrypt']);
    expect(events.every((e) => e.purpose === 'ownership_salt')).toBe(true);
  });
});
